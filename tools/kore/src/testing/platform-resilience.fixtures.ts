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

/** An HTTPRoute the controller has accepted, with its parent's Accepted and ResolvedRefs true. */
export function healthyRouteOutput(
  args: readonly string[],
): string | undefined {
  if (!args.some((arg) => arg.startsWith("httproute/"))) {
    return undefined;
  }
  const condition = (type: string) => ({ type, status: "True" });
  return JSON.stringify({
    status: {
      parents: [
        { conditions: [condition("Accepted"), condition("ResolvedRefs")] },
      ],
    },
  });
}

/** An initialised, unsealed OpenBao that has its audit file, as the in-pod reads of its readiness check see it. */
export function healthyOpenbaoOutput(
  args: readonly string[],
): string | undefined {
  const command = args.at(-1) ?? "";
  if (!args.includes("openbao-0")) {
    return undefined;
  }
  if (command.includes("bao status")) {
    return JSON.stringify({ initialized: true, sealed: false });
  }
  return command.includes("audit.log") ? "audit" : undefined;
}

/** An XRD Crossplane has rendered (its condition observed its generation) and its CRD; neither declares a field, so nothing is missing. */
export function healthyXrdOutput(args: readonly string[]): string | undefined {
  if (!args.includes("json")) {
    return undefined;
  }
  if (
    args.some((arg) =>
      arg.startsWith(
        "compositeresourcedefinition.apiextensions.crossplane.io/",
      ),
    )
  ) {
    return JSON.stringify({
      metadata: { generation: 1 },
      spec: { versions: [] },
      status: {
        conditions: [
          { type: "Established", status: "True", observedGeneration: 1 },
        ],
      },
    });
  }
  return args.some((arg) => arg.startsWith("crd/"))
    ? JSON.stringify({ spec: { versions: [] } })
    : undefined;
}

/** What a healthy cluster answers to any read-only readiness check, if args are one. */
export function healthyClusterOutput(args: readonly string[]): string {
  return (
    healthyApplicationOutput(args) ??
    healthyGatewayOutput(args) ??
    healthyRouteOutput(args) ??
    healthyDaemonSetOutput(args) ??
    healthyWebhookOutput(args) ??
    healthyOpenbaoOutput(args) ??
    healthyXrdOutput(args) ??
    "ready"
  );
}
