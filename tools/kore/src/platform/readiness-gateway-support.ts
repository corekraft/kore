// Fakes and fixtures shared by the gateway readiness unit spec. A support file
// is not a unit, so it needs no spec of its own (ADR 0098).
import { vi } from "vitest";
import { featureEnabled, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { routeProblem } from "./gateway-proof.js";
import { pollUntil } from "./readiness-poll.js";

export const BASE = [
  "--context",
  "k3d-kore-local",
  "--namespace",
  "kore-system",
];
export const GATEWAY = "gateway/kore";

/** The environment's Gateway port maps to the load balancer's node port 30443. */
export const repository = {
  environment: {
    kubeContext: "k3d-kore-local",
    gateway: { port: 8443 },
    k3d: { ports: [{ hostPort: 8443, loadBalancerPort: 30443 }] },
  },
} as unknown as Repository;

type Reply = Record<string, unknown>;

/**
 * A typed runner that answers each kubectl call with the JSON stored under the
 * first key its joined arguments contain; a key mapped to "" answers nothing.
 */
export function kube(replies: Reply) {
  const run = vi.fn<Runner["run"]>(async (_command, args) => {
    const joined = args.join(" ");
    const key = Object.keys(replies).find((candidate) =>
      joined.includes(candidate),
    );
    const answer = key === undefined ? {} : replies[key];
    return {
      stdout: typeof answer === "string" ? answer : JSON.stringify(answer),
      stderr: "",
      code: 0,
    };
  });
  return { runner: { run } as Runner, run };
}

/** A Gateway status with the given conditions and listener conditions. */
export const gateway = (conditions: object[], listeners: object[] = []) => ({
  status: { conditions, listeners },
});
export const accepted = { type: "Accepted", status: "True" };
export const programmed = { type: "Programmed", status: "True" };
export const published = {
  items: [
    {
      spec: { type: "LoadBalancer" },
      status: { loadBalancer: { ingress: [{ ip: "10.0.0.2" }] } },
    },
  ],
};
/** Every step passes: accepted, published, programmed and every listener resolved. */
export const passing = {
  "gateway/kore": gateway(
    [accepted, programmed],
    [{ name: "https", conditions: [{ type: "ResolvedRefs", status: "True" }] }],
  ),
  "--selector": published,
};

/** The default answers: no ingress flag, no route problem, and a poll that makes one probe. */
export function primeGatewayFakes(): void {
  vi.mocked(featureEnabled).mockReturnValue(false);
  vi.mocked(routeProblem).mockReturnValue(undefined);
  vi.mocked(pollUntil).mockImplementation(async (_timeout, probe) => {
    const reason = await probe();
    if (reason !== undefined) {
      throw new Error(reason);
    }
  });
}
