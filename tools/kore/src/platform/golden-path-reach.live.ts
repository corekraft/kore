import type { Runner } from "../runtime/index.js";

// Docs: infra/plans/13-agentgateway-ingress.md#golden-path-route-set
//
// Where the host reaches the golden-path Service's own Gateway. The Service is
// a LoadBalancer, and on k3d its address stays pending unless the environment
// publishes one; the k3d port mapping serves only the shared Gateway. So the
// live probes take the published address and its port from the Service, or
// refuse by name before any load is sent. Read-only: one `kubectl get`.

export interface GoldenPathReachOptions {
  kubeContext: string;
  /** The service namespace, `<service>--<environment>`. */
  namespace: string;
  /** The delivered Service, which is also the Gateway's name. */
  service: string;
}

export interface GoldenPathReach {
  /** The published IP or hostname the probes resolve the service host to. */
  address: string;
  /** The port the Service declares for the Gateway. */
  port: number;
}

interface ServiceDocument {
  spec?: { ports?: { port?: number }[] };
  status?: {
    loadBalancer?: { ingress?: { ip?: string; hostname?: string }[] };
  };
}

export async function goldenPathReach(
  runner: Runner,
  options: GoldenPathReachOptions,
): Promise<GoldenPathReach> {
  const { kubeContext, namespace, service } = options;
  const subject = `the golden-path Service ${namespace}/${service} on context ${kubeContext}`;
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      kubeContext,
      "--namespace",
      namespace,
      "get",
      "service",
      service,
      "--output",
      "json",
    ],
    { capture: true },
  );
  const parsed = JSON.parse(stdout) as ServiceDocument;
  const published = parsed.status?.loadBalancer?.ingress?.[0];
  const address = published?.ip ?? published?.hostname;
  if (address === undefined) {
    throw new Error(
      `${subject} has no published address (status.loadBalancer.ingress is empty), so the host cannot reach its Gateway; the reference routes at kore.local are unaffected; the shared Gateway attach (#1211) publishes the address`,
    );
  }
  const port = parsed.spec?.ports?.[0]?.port;
  if (port === undefined) {
    throw new Error(
      `${subject} declares no port, so there is nothing to reach at ${address}; check the delivered chart's Service`,
    );
  }
  return { address, port };
}
