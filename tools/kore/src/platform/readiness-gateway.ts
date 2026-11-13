import {
  featureEnabled,
  ingressFlag,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { routeProblem } from "./gateway-proof.js";
import { pollUntil } from "./readiness-poll.js";

/** What a gateway check reads from: the repository, runner and kubectl scope. */
export interface GatewayContext {
  repository: Repository;
  runner: Runner;
  base: string[];
}

interface Condition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
}
interface GatewayStatus {
  conditions: Condition[];
  listeners: { name: string; conditions: Condition[] }[];
}

function describe(condition: Condition | undefined, label: string): string {
  if (!condition) {
    return `${label} has not been reported yet`;
  }
  const reason = condition.reason ? ` (reason: ${condition.reason})` : "";
  const message = condition.message ? `: ${condition.message}` : "";
  return `${label} is ${condition.status}${reason}${message}`;
}

async function gatewayStatus(
  runner: Runner,
  base: string[],
  resource: string,
): Promise<GatewayStatus> {
  const result = await runner.run(
    "kubectl",
    [...base, "get", resource, "--output", "json"],
    { capture: true },
  );
  const parsed = JSON.parse(result.stdout) as {
    status?: Partial<GatewayStatus>;
  };
  return {
    conditions: parsed.status?.conditions ?? [],
    listeners: parsed.status?.listeners ?? [],
  };
}

function holds(conditions: Condition[], type: string): string | undefined {
  const found = conditions.find((condition) => condition.type === type);
  return found?.status === "True" ? undefined : describe(found, type);
}

/**
 * The node port the environment configures for the Gateway Service: the one
 * its load balancer maps the Gateway host port to, which the overlay's
 * `gateway.service.nodePort` must equal (gateway-service.spec.ts).
 */
function configuredNodePort(repository: Repository): number | undefined {
  const { k3d, gateway } = repository.environment;
  return k3d?.ports.find(({ hostPort }) => hostPort === gateway.port)
    ?.loadBalancerPort;
}

/** Undefined once the Service is published; otherwise why it is not. */
async function unpublished(
  repository: Repository,
  runner: Runner,
  base: string[],
  name: string,
): Promise<string | undefined> {
  const result = await runner.run(
    "kubectl",
    [
      ...base,
      "get",
      "service",
      "--selector",
      `gateway.networking.k8s.io/gateway-name=${name}`,
      "--output",
      "json",
    ],
    { capture: true },
  );
  const parsed = JSON.parse(result.stdout) as {
    items?: {
      spec?: { type?: string; ports?: { nodePort?: number }[] };
      status?: { loadBalancer?: { ingress?: unknown[] } };
    }[];
  };
  const items = parsed.items ?? [];
  // A LoadBalancer Service is published once it has an address.
  if (items.some((i) => (i.status?.loadBalancer?.ingress ?? []).length > 0)) {
    return undefined;
  }
  // A NodePort Service never gets one: the environment's own load balancer
  // reaches it on the configured node port, so that port must be assigned.
  const expected = configuredNodePort(repository);
  const assigned = items
    .filter((i) => i.spec?.type === "NodePort")
    .flatMap((i) => i.spec?.ports ?? [])
    .flatMap(({ nodePort }) => (nodePort === undefined ? [] : [nodePort]));
  if (
    assigned.length > 0 &&
    (expected === undefined || assigned.includes(expected))
  ) {
    return undefined;
  }
  return assigned.length > 0
    ? `Service has node port ${assigned.join(", ")} but the configured node port ${expected} is not assigned`
    : "Service has no LoadBalancer address or node port";
}

/** The Service and Deployment Istio generates for a Gateway of the `istio` class. */
function istioProxyResources(name: string): string[] {
  return [`deployment/${name}-istio`, `service/${name}-istio`];
}

/**
 * Waits until the Istio ingress proxy is gone, so a profile that served
 * ingress through Istio has handed the Gateway to agentgateway before anything
 * is called ready. Istio is the only owner of these two names.
 */
async function waitForIstioProxyGone(
  runner: Runner,
  base: string[],
  name: string,
  timeout: string,
): Promise<void> {
  await pollUntil(timeout, async () => {
    for (const resource of istioProxyResources(name)) {
      const result = await runner.run(
        "kubectl",
        [...base, "get", resource, "--ignore-not-found", "--output", "name"],
        { capture: true },
      );
      if (result.stdout.trim() !== "") {
        return `Istio ingress proxy ${resource} still exists; Istio has not released the Gateway to agentgateway. Remove it: ${["kubectl", ...base, "delete", resource].join(" ")}`;
      }
    }
    return undefined;
  });
}

/**
 * Undefined once agentgateway's GatewayClass is accepted; otherwise the reason
 * agentgateway reported, so a missing or broken controller fails fast.
 */
async function classProblem(
  runner: Runner,
  base: string[],
): Promise<string | undefined> {
  const result = await runner.run(
    "kubectl",
    [...base, "get", "gatewayclass/agentgateway", "--output", "json"],
    { capture: true },
  );
  const parsed = JSON.parse(result.stdout) as {
    status?: { conditions?: Condition[] };
  };
  const problem = holds(parsed.status?.conditions ?? [], "Accepted");
  return problem === undefined ? undefined : `GatewayClass ${problem}`;
}

/** Prefixes a failure with the controller that reported it, when it is agentgateway. */
function named(
  controller: string | undefined,
  problem: string | undefined,
): string | undefined {
  return problem !== undefined && controller !== undefined
    ? `${controller}: ${problem}`
    : problem;
}

/**
 * Read-only Gateway readiness: with the ingress flag on, the Istio ingress
 * proxy gone and agentgateway's GatewayClass accepted; then Accepted, a
 * LoadBalancer address (or assigned node port) on its Service, Programmed, then
 * every listener's ResolvedRefs. Each step is bounded by `timeout` and fails
 * with the condition reason the controller reported, naming agentgateway when
 * it serves the Gateway.
 */
export async function waitForGateway(
  repository: Repository,
  runner: Runner,
  base: string[],
  resource: string,
  timeout: string,
): Promise<void> {
  const name = resource.slice("gateway/".length);
  const controller = featureEnabled(repository.environment, ingressFlag)
    ? "agentgateway"
    : undefined;
  if (controller !== undefined) {
    await waitForIstioProxyGone(runner, base, name, timeout);
    await pollUntil(timeout, async () =>
      named(controller, await classProblem(runner, base)),
    );
  }
  await pollUntil(timeout, async () =>
    named(
      controller,
      holds(
        (await gatewayStatus(runner, base, resource)).conditions,
        "Accepted",
      ),
    ),
  );
  await pollUntil(timeout, async () => {
    const reason = await unpublished(repository, runner, base, name);
    if (reason === undefined) {
      return undefined;
    }
    const { conditions } = await gatewayStatus(runner, base, resource);
    const programmed = conditions.find(({ type }) => type === "Programmed");
    return named(
      controller,
      `${reason}; ${describe(programmed, "Programmed")}`,
    );
  });
  await pollUntil(timeout, async () =>
    named(
      controller,
      holds(
        (await gatewayStatus(runner, base, resource)).conditions,
        "Programmed",
      ),
    ),
  );
  await pollUntil(timeout, async () => {
    const { listeners } = await gatewayStatus(runner, base, resource);
    const failing = listeners
      .map(({ name: listener, conditions }) => ({
        listener,
        reason: holds(conditions, "ResolvedRefs"),
      }))
      .filter(({ reason }) => reason !== undefined);
    return named(
      controller,
      failing.length
        ? failing
            .map(({ listener, reason }) => `listener ${listener} ${reason}`)
            .join("; ")
        : undefined,
    );
  });
}

/**
 * Read-only HTTPRoute readiness: a controller has reported on the route, and
 * every parent reports Accepted and ResolvedRefs. Failure names the unmet
 * condition and its reason; `resource` is `httproute/<name>`, read in the
 * component's namespace.
 */
export async function waitForHTTPRoute(
  runner: Runner,
  base: string[],
  resource: string,
  timeout: string,
): Promise<void> {
  await pollUntil(timeout, async () => {
    const result = await runner.run(
      "kubectl",
      [...base, "get", resource, "--output", "json"],
      { capture: true },
    );
    return routeProblem(JSON.parse(result.stdout) as Record<string, unknown>);
  });
}

/** The readiness check for a `gateway/` or `httproute/` resource, if it is one. */
export function gatewayCheck(
  { repository, runner, base }: GatewayContext,
  resource: string,
): { condition: string; run: (timeout: string) => Promise<void> } | undefined {
  if (resource.startsWith("gateway/")) {
    const conditions =
      "Accepted, LoadBalancer address or node port, Programmed, ResolvedRefs";
    return {
      condition: featureEnabled(repository.environment, ingressFlag)
        ? `Istio ingress proxy gone, GatewayClass agentgateway Accepted, ${conditions}`
        : conditions,
      run: (timeout) =>
        waitForGateway(repository, runner, base, resource, timeout),
    };
  }
  if (resource.startsWith("httproute/")) {
    return {
      condition: "Accepted and ResolvedRefs",
      run: (timeout) => waitForHTTPRoute(runner, base, resource, timeout),
    };
  }
  return undefined;
}
