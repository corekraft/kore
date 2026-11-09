import { healthyWebhookOutput } from "./webhook-fixtures.js";

/** A programmed Gateway with an address and resolved listeners. */
export function healthyGatewayOutput(
  args: readonly string[],
): string | undefined {
  const condition = (type: string) => ({ type, status: "True" });
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
  return healthyGatewayOutput(args) ?? healthyWebhookOutput(args) ?? "ready";
}
