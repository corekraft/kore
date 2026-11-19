import {
  healthyApplicationOutput,
  healthyDaemonSetOutput,
  healthyWebhookOutput,
} from "./webhook-fixtures.js";

/** A programmed Gateway with an address and resolved listeners. */
export function healthyGatewayOutput(
  args: readonly string[],
): string | undefined {
  const condition = (type: string) => ({ type, status: "True" });
  // No Gateway class and no old proxy: a fresh profile, so the class-change
  // step before the Helm upgrade has nothing to delete or wait for.
  if (
    args.includes("jsonpath={.spec.gatewayClassName}") ||
    (args.includes("name") &&
      args.some(
        (arg) =>
          arg === "gateway/kore-gateway" ||
          arg.endsWith("kore-gateway-istio") ||
          arg === "gateway.networking.k8s.io/gateway-name=kore-gateway",
      ))
  ) {
    return "";
  }
  if (args.some((arg) => arg.startsWith("gateway/"))) {
    return JSON.stringify({
      status: {
        conditions: [condition("Accepted"), condition("Programmed")],
        listeners: [{ name: "https", conditions: [condition("ResolvedRefs")] }],
      },
    });
  }
  return args.includes("--selector")
    ? JSON.stringify({
        items: [
          { status: { loadBalancer: { ingress: [{ ip: "10.0.0.1" }] } } },
        ],
      })
    : undefined;
}

/** What a healthy cluster answers to any read-only readiness check, if args are one. */
export function healthyClusterOutput(args: readonly string[]): string {
  return (
    healthyApplicationOutput(args) ??
    healthyGatewayOutput(args) ??
    healthyDaemonSetOutput(args) ??
    healthyWebhookOutput(args) ??
    "ready"
  );
}
