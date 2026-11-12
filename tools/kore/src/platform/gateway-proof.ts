// Docs: docs/decisions/0013-local-tls-before-gateway.md
//
// Pure helpers for the opt-in Gateway, TLS, and Secret materialization proof
// (`npm run test:integration:gateway`). They build the throwaway objects and
// judge cluster status; nothing here talks to a cluster or reads a secret value.

export type Json = Record<string, unknown>;

export interface ProofOptions {
  namespace: string;
  hostname: string;
  gateway: { name: string; namespace: string };
  /** An already-approved, signed image reference (the one the reference app runs). */
  image: string;
  pullPolicy: string;
  storeName: string;
  source: { key: string; property: string };
  target: { secret: string; key: string };
}

const BACKEND = "echo";

const SECURITY_CONTEXT = {
  allowPrivilegeEscalation: false,
  readOnlyRootFilesystem: true,
  runAsNonRoot: true,
  runAsUser: 1000,
  runAsGroup: 1000,
  capabilities: { drop: ["ALL"] },
};

function backend(options: ProofOptions): Json[] {
  const { namespace } = options;
  const labels = { "app.kubernetes.io/name": BACKEND };
  const container = {
    name: "app",
    image: options.image,
    imagePullPolicy: options.pullPolicy,
    env: [{ name: "APP_MODE", value: "frontend" }],
    ports: [{ name: "http", containerPort: 8080 }],
    readinessProbe: {
      httpGet: { path: "/livez", port: "http" },
      periodSeconds: 2,
    },
    securityContext: SECURITY_CONTEXT,
  };
  return [
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: BACKEND, namespace },
      spec: {
        replicas: 1,
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            automountServiceAccountToken: false,
            containers: [container],
          },
        },
      },
    },
    {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: BACKEND, namespace },
      spec: {
        selector: labels,
        ports: [{ name: "http", port: 8080, targetPort: "http" }],
      },
    },
  ];
}

function httpRoute(options: ProofOptions): Json {
  return {
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "HTTPRoute",
    metadata: { name: BACKEND, namespace: options.namespace },
    spec: {
      parentRefs: [
        { name: options.gateway.name, namespace: options.gateway.namespace },
      ],
      hostnames: [options.hostname],
      rules: [
        {
          matches: [{ path: { type: "PathPrefix", value: "/" } }],
          backendRefs: [{ name: BACKEND, port: 8080 }],
        },
      ],
    },
  };
}

function externalSecret(options: ProofOptions): Json {
  return {
    apiVersion: "external-secrets.io/v1",
    kind: "ExternalSecret",
    metadata: { name: "proof", namespace: options.namespace },
    spec: {
      refreshInterval: "1h",
      secretStoreRef: { kind: "ClusterSecretStore", name: options.storeName },
      target: { name: options.target.secret },
      data: [
        {
          secretKey: options.target.key,
          remoteRef: {
            key: options.source.key,
            property: options.source.property,
          },
        },
      ],
    },
  };
}

/** The throwaway namespace's objects: backend, route, and an ExternalSecret. */
export function proofManifests(options: ProofOptions): Json[] {
  return [
    {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        name: options.namespace,
        labels: { "kore.dev/proof": "gateway-tls" },
      },
    },
    ...backend(options),
    httpRoute(options),
    externalSecret(options),
  ];
}

interface Condition {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
}

function conditionsOf(value: unknown): Condition[] {
  return Array.isArray(value) ? (value as Condition[]) : [];
}

function describe(condition: Condition | undefined, type: string): string {
  if (!condition) {
    return `${type} has not been reported`;
  }
  const reason = condition.reason ? ` (reason: ${condition.reason})` : "";
  const message = condition.message ? `: ${condition.message}` : "";
  return `${type} is ${condition.status}${reason}${message}`;
}

/** The first reason an HTTPRoute is not Accepted and ResolvedRefs, if any. */
export function routeProblem(route: Json): string | undefined {
  const status = (route.status ?? {}) as {
    parents?: { conditions?: unknown }[];
  };
  const parents = status.parents ?? [];
  if (parents.length === 0) {
    return "HTTPRoute has no parent status yet";
  }
  for (const parent of parents) {
    const conditions = conditionsOf(parent.conditions);
    for (const type of ["Accepted", "ResolvedRefs"]) {
      const found = conditions.find((condition) => condition.type === type);
      if (found?.status !== "True") {
        return describe(found, type);
      }
    }
  }
  return undefined;
}

/** The first reason a Certificate is not ready, un-renewable, or expired. */
export function certificateProblem(
  certificate: Json,
  now: Date,
): string | undefined {
  const status = (certificate.status ?? {}) as {
    conditions?: unknown;
    notAfter?: string;
    renewalTime?: string;
  };
  const ready = conditionsOf(status.conditions).find(
    (condition) => condition.type === "Ready",
  );
  if (ready?.status !== "True") {
    return describe(ready, "Ready");
  }
  if (!status.notAfter) {
    return "Certificate status has no notAfter";
  }
  if (!status.renewalTime) {
    return "Certificate status has no renewalTime";
  }
  const expiry = Date.parse(status.notAfter);
  const renewal = Date.parse(status.renewalTime);
  if (expiry <= now.getTime()) {
    return `Certificate expired at ${status.notAfter}`;
  }
  if (renewal >= expiry) {
    return `renewalTime ${status.renewalTime} must be before notAfter ${status.notAfter}`;
  }
  return undefined;
}

/** The key names of a Secret, sorted. Values are never read or returned. */
export function secretKeys(secret: Json): string[] {
  return Object.keys((secret.data ?? {}) as Json).sort();
}

/**
 * Whether the host runs a tunnel that could be what answers the Gateway port:
 * a `minikube tunnel`, or the `ssh -L` forward it holds the port with. The
 * k3d load balancer publishes the port with neither, so any hit means the
 * endpoint is not answering through the load balancer. Undefined when none.
 */
export function tunnelProcessProblem(
  processes: { pid: number; command: string }[],
  port: number,
): string | undefined {
  for (const { pid, command } of processes) {
    const tokens = command.split(/\s+/).filter((token) => token !== "");
    const binary = tokens[0] ?? "";
    if (
      (binary === "minikube" || binary.endsWith("/minikube")) &&
      tokens[1] === "tunnel"
    ) {
      return `a minikube tunnel is running (pid ${pid}); the load balancer must answer with no tunnel process`;
    }
    const forwards = tokens.some(
      (token, index) =>
        (token === "-L" &&
          (tokens[index + 1] ?? "").split(":").includes(String(port))) ||
        (token.startsWith("-L") &&
          token.slice(2).split(":").includes(String(port))),
    );
    if (
      (binary === "ssh" || binary.endsWith("/ssh")) &&
      forwards &&
      command.includes("/.minikube/")
    ) {
      return `a minikube ssh forward holds port ${port} (pid ${pid}); the load balancer must answer with no tunnel process`;
    }
  }
  return undefined;
}
