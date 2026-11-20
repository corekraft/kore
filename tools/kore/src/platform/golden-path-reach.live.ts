import type { Runner } from "../runtime/index.js";

// Docs: infra/plans/13-agentgateway-ingress.md#golden-path-route-set

// Which Gateway the host reaches for the golden-path Service. A delivered
// Service with its own Gateway is a LoadBalancer, and on k3d its address stays
// pending unless the environment publishes one, so its probes take the
// published address and port or refuse by name before any load is sent. A
// Service with no Gateway of its own (platform-shared-gateway on) has no
// Service to read; its HTTPRoute is served by the shared Gateway, which the k3d
// load balancer maps on loopback at the environment's gateway port. Read-only:
// the kubectl reads below change nothing.

export interface GoldenPathReachOptions {
  kubeContext: string;
  /** The service namespace, `<service>--<environment>`. */
  namespace: string;
  /** The delivered Service, which is also the Gateway's name when it has one. */
  service: string;
  /** The environment's shared Gateway and the port the k3d load balancer maps to it. */
  sharedGateway: { namespace: string; name: string; port: number };
}

export interface GoldenPathReach {
  /** The Gateway the probes reach: the service's own, or the shared one. */
  gateway: { namespace: string; name: string };
  /** `service` for the service's own Gateway, `shared` for the shared one. */
  via: "service" | "shared";
  /** The published IP or hostname the probes resolve the service host to; unset is loopback. */
  address?: string;
  /** The port the probes use. */
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
      "--ignore-not-found",
      "--output",
      "json",
    ],
    { capture: true },
  );
  if (stdout.trim() === "") {
    return sharedReach(runner, options, subject);
  }
  const parsed = JSON.parse(stdout) as ServiceDocument;
  const gateway = { namespace, name: service };
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
  return { gateway, via: "service", address, port };
}

/**
 * The service has no Gateway of its own: its HTTPRoute must exist on the shared
 * Gateway, and the probes reach that Gateway on loopback, where the k3d load
 * balancer maps the port. Refused by name when the route is absent, so a missing
 * route fails before the load rather than as 404s after the settle wait.
 */
async function sharedReach(
  runner: Runner,
  options: GoldenPathReachOptions,
  subject: string,
): Promise<GoldenPathReach> {
  const { kubeContext, namespace, service, sharedGateway } = options;
  const route = `${service}-shared`;
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      kubeContext,
      "--namespace",
      namespace,
      "get",
      "httproute",
      route,
      "--ignore-not-found",
      "--output",
      "name",
    ],
    { capture: true },
  );
  if (stdout.trim() === "") {
    throw new Error(
      `${subject} has no Gateway of its own, and its HTTPRoute ${route} is absent from ${namespace}, so the shared Gateway ${sharedGateway.namespace}/${sharedGateway.name} has no route to the host; deliver the service with platform-shared-gateway on (ADR 0134)`,
    );
  }
  return {
    gateway: { namespace: sharedGateway.namespace, name: sharedGateway.name },
    via: "shared",
    port: sharedGateway.port,
  };
}
