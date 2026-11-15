import {
  gatewayClassName,
  type Component,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { pollUntil } from "./readiness-poll.js";

/** The release that owns the platform Gateway, and the Gateway's name. */
const OWNER = "kore-platform-config";
const GATEWAY = "gateway/kore-gateway";

/** What Istio generates for a Gateway of the `istio` class, plus anything labelled for the Gateway. */
const PROXY_QUERIES = [
  ["deployment/kore-gateway-istio"],
  ["service/kore-gateway-istio"],
  [
    "deployment,service",
    "--selector",
    "gateway.networking.k8s.io/gateway-name=kore-gateway",
  ],
];

async function names(
  runner: Runner,
  base: string[],
  args: string[],
): Promise<string[]> {
  const { stdout } = await runner.run(
    "kubectl",
    [...base, "get", ...args, "--ignore-not-found", "--output", "name"],
    { capture: true },
  );
  return stdout.split("\n").filter((line) => line.trim() !== "");
}

/**
 * Hands the platform Gateway to a new class before Helm upgrades its release.
 * A Gateway's class decides which controller builds its proxy, and the old
 * controller's proxy keeps the Gateway from being Programmed, so a class change
 * deletes the Gateway (never a deployment or service: Kubernetes garbage
 * collection removes the old proxy through its ownerReference), waits until it
 * and the old proxy are gone, and lets the Helm upgrade that follows recreate
 * it in the new class. The Gateway is briefly absent, so ingress has a short
 * outage. A matching class or an absent Gateway (a fresh profile) is a no-op.
 */
export async function releaseGatewayClassChange(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<void> {
  if (component.name !== OWNER) {
    return;
  }
  const base = [
    "--context",
    repository.environment.kubeContext,
    "--namespace",
    component.namespace,
  ];
  const desired = gatewayClassName(repository.environment);
  const { stdout } = await runner.run(
    "kubectl",
    [
      ...base,
      "get",
      GATEWAY,
      "--ignore-not-found",
      "--output",
      "jsonpath={.spec.gatewayClassName}",
    ],
    { capture: true },
  );
  const current = stdout.trim();
  if (current === "" || current === desired) {
    return;
  }
  await runner.run(
    "kubectl",
    [...base, "delete", GATEWAY, "--ignore-not-found"],
    { capture: true },
  );
  await pollUntil(component.timeout, async () => {
    for (const query of [[GATEWAY], ...PROXY_QUERIES]) {
      const [left] = await names(runner, base, query);
      if (left !== undefined) {
        return `Gateway kore-gateway changed class from ${current} to ${desired} but ${left} still exists in ${component.namespace}; Kubernetes has not garbage-collected the old proxy. Check it with: kubectl ${base.join(" ")} get deployment,service`;
      }
    }
    return undefined;
  });
}
