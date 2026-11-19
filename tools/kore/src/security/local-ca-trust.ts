import { localCaConfigMap, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md

/** `kore trust install` keeps the mkcert root and its key here; only the public certificate is read. */
const caNamespace = "cert-manager";
const caSecret = "kore-local-ca-key-pair";
/** Kubernetes publishes the cluster CA to every namespace; kube-system is always present. */
const clusterCaNamespace = "kube-system";
const clusterCaConfigMap = "kube-root-ca.crt";
const fieldManager = "kore-local-ca";

const pemCertificate =
  /^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*$/;

function localCaProblem(repository: Repository, reason: string): Error {
  return new Error(
    `the local CA ${reason} (Secret ${caNamespace}/${caSecret}, key tls.crt); pods trust it only once it exists, so run \`kore trust install --environment ${repository.environment.name}\`, then rerun`,
  );
}

function clusterCaMissing(repository: Repository): Error {
  return new Error(
    `the cluster CA is missing (ConfigMap ${clusterCaNamespace}/${clusterCaConfigMap}, key ca.crt); the portal's trust bundle needs it beside the local CA, so check access to the cluster ${repository.environment.kubeContext}, then rerun`,
  );
}

async function getJson(
  repository: Repository,
  runner: Runner,
  namespace: string,
  kind: string,
  name: string,
): Promise<{ data?: Record<string, string> } | undefined> {
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      namespace,
      "get",
      kind,
      name,
      "--ignore-not-found",
      "--output=json",
    ],
    { capture: true },
  );
  if (stdout.trim() === "") {
    return undefined;
  }
  const parsed: unknown = JSON.parse(stdout);
  return isObject(parsed) && isObject(parsed["data"])
    ? { data: stringEntries(parsed["data"]) }
    : {};
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The string-valued entries of a Secret's or ConfigMap's data. */
function stringEntries(data: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(data).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** The local CA's public certificate; only tls.crt is read, never the key beside it. */
async function loadLocalCa(
  repository: Repository,
  runner: Runner,
): Promise<string> {
  const secret = await getJson(
    repository,
    runner,
    caNamespace,
    "secret",
    caSecret,
  );
  const pem = Buffer.from(secret?.data?.["tls.crt"] ?? "", "base64").toString(
    "utf8",
  );
  if (pem === "") {
    throw localCaProblem(repository, "is missing");
  }
  if (!pemCertificate.test(pem)) {
    throw localCaProblem(repository, "is not a PEM certificate");
  }
  return pem;
}

/**
 * Hands the local CA to the portal's pods, following the registry CA's
 * precedent (ADR 0058): the public certificate is read from the cluster and
 * applied as a ConfigMap in the namespace that mounts it, by stdin, with the
 * same content on every run. The ConfigMap holds `ca.crt`, the local CA, for
 * the sign-in proxy, and `bundle.crt`, the local CA followed by the cluster CA,
 * for Node, which reads one file and must keep trusting the API server. Fails
 * closed when either CA is absent.
 */
export async function ensureLocalCaTrust(
  repository: Repository,
  runner: Runner,
  namespace: string,
): Promise<void> {
  const ca = await loadLocalCa(repository, runner);
  const clusterCa = (
    await getJson(
      repository,
      runner,
      clusterCaNamespace,
      "configmap",
      clusterCaConfigMap,
    )
  )?.data?.["ca.crt"];
  if (clusterCa === undefined || clusterCa === "") {
    throw clusterCaMissing(repository);
  }
  await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "apply",
      "--server-side",
      `--field-manager=${fieldManager}`,
      "--force-conflicts",
      "--filename=-",
    ],
    {
      capture: true,
      input: JSON.stringify({
        apiVersion: "v1",
        kind: "List",
        items: [
          {
            apiVersion: "v1",
            kind: "Namespace",
            metadata: { name: namespace },
          },
          {
            apiVersion: "v1",
            kind: "ConfigMap",
            metadata: {
              name: localCaConfigMap,
              namespace,
              labels: { "app.kubernetes.io/managed-by": fieldManager },
            },
            data: { "ca.crt": ca, "bundle.crt": `${ca}${clusterCa}` },
          },
        ],
      }),
    },
  );
}
