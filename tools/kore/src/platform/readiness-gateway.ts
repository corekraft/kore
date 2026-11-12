import type { Runner } from "../runtime/index.js";
import { routeProblem } from "./gateway-proof.js";
import { pollUntil } from "./readiness-poll.js";

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

async function isPublished(
  runner: Runner,
  base: string[],
  name: string,
): Promise<boolean> {
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
  // A LoadBalancer Service is published once it has an address. A NodePort
  // Service never gets one: the environment's own load balancer reaches it on
  // the node port, so an assigned node port is the readiness signal.
  return (parsed.items ?? []).some(
    (item) =>
      (item.status?.loadBalancer?.ingress ?? []).length > 0 ||
      (item.spec?.type === "NodePort" &&
        (item.spec.ports ?? []).some(({ nodePort }) => nodePort !== undefined)),
  );
}

/**
 * Read-only Gateway readiness: Accepted, a LoadBalancer address (or assigned node port) on its Service,
 * Programmed, then every listener's ResolvedRefs. Each step is bounded by
 * `timeout` and fails with the condition reason the controller reported.
 */
export async function waitForGateway(
  runner: Runner,
  base: string[],
  resource: string,
  timeout: string,
): Promise<void> {
  const name = resource.slice("gateway/".length);
  await pollUntil(timeout, async () =>
    holds((await gatewayStatus(runner, base, resource)).conditions, "Accepted"),
  );
  await pollUntil(timeout, async () => {
    if (await isPublished(runner, base, name)) {
      return undefined;
    }
    const { conditions } = await gatewayStatus(runner, base, resource);
    const programmed = conditions.find(({ type }) => type === "Programmed");
    return `Service has no LoadBalancer address or node port; ${describe(programmed, "Programmed")}`;
  });
  await pollUntil(timeout, async () =>
    holds(
      (await gatewayStatus(runner, base, resource)).conditions,
      "Programmed",
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
    return failing.length
      ? failing
          .map(({ listener, reason }) => `listener ${listener} ${reason}`)
          .join("; ")
      : undefined;
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
  runner: Runner,
  base: string[],
  resource: string,
): { condition: string; run: (timeout: string) => Promise<void> } | undefined {
  if (resource.startsWith("gateway/")) {
    return {
      condition:
        "Accepted, LoadBalancer address or node port, Programmed, ResolvedRefs",
      run: (timeout) => waitForGateway(runner, base, resource, timeout),
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
