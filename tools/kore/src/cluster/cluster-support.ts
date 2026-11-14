// Fakes shared by the cluster domain's unit specs. A support file is not a unit,
// so it needs no spec of its own (ADR 0098).
import type { Mock } from "vitest";
import { vi } from "vitest";
import type { Repository } from "../config/index.js";
import type { RunResult, Runner } from "../runtime/index.js";

export type Run = Runner["run"];

/** A typed runner whose stdout comes from `reply`; a reply that throws fails the command. */
export function fakeRunner(
  reply: (command: string, args: readonly string[]) => string = () => "",
) {
  const run = vi.fn<Run>(async (command, args): Promise<RunResult> => ({
    stdout: reply(command, args),
    stderr: "",
    code: 0,
  }));
  return { runner: { run } as Runner, run };
}

/** Every command the runner received, as the line a person would type. */
export function commandLines(run: Mock<Run>): string[] {
  return run.mock.calls.map(([command, args]) => [command, ...args].join(" "));
}

export const pinnedK3s = "rancher/k3s:v1.37.2-k3s1@sha256:abc";

/**
 * A local k3d repository with the fields the cluster domain reads. Overrides
 * replace the environment's fields; `k3d: undefined` makes it a non-k3d overlay.
 */
export function fakeRepository(
  environment: Record<string, unknown> = {},
  versions: Record<string, unknown> = { images: { k3s: pinnedK3s } },
): Repository {
  return {
    root: "/repo",
    versions,
    environment: {
      name: "local",
      provider: "k3d",
      kubeContext: "k3d-kore-local",
      k3d: {
        clusterName: "kore-local",
        serviceCidr: "10.96.0.0/12",
        ports: [{ hostPort: 8443, loadBalancerPort: 443 }],
      },
      ...environment,
    },
  } as unknown as Repository;
}

/** One entry of `k3d cluster list --output json`, with a join token that must never leak. */
export function k3dEntry(
  running: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "kore-local",
    token: "SECRET-TOKEN",
    serversCount: 1,
    serversRunning: running,
    agentsCount: 0,
    agentsRunning: 0,
    hasLoadBalancer: true,
    ...overrides,
  };
}

/**
 * A k3d cluster that answers like the real one: `running` is the running server
 * count (undefined when absent), and create or start brings every node up.
 * kubectl answers the context's namespace name with `namespace`.
 */
export function fakeK3d(
  running: number | undefined,
  overrides: Record<string, unknown> = {},
  namespace = "kube-system",
) {
  let state = running;
  let current = overrides;
  return fakeRunner((command, args) => {
    if (command === "k3d" && ["create", "start"].includes(args[1] ?? "")) {
      state = 1;
      current = {
        ...current,
        serversRunning: current["serversCount"] ?? 1,
        agentsRunning: current["agentsCount"] ?? 0,
      };
      return "";
    }
    if (command === "k3d" && args[1] === "list") {
      return JSON.stringify(
        state === undefined ? [] : [k3dEntry(state, current)],
      );
    }
    if (args.includes("jsonpath={.metadata.name}")) {
      return namespace;
    }
    return "";
  });
}
