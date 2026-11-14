// Fakes and data for the gate unit specs: a repository, components and a runner.
import { vi } from "vitest";
import type {
  ApprovedEntry,
  Component,
  Environment,
  Repository,
} from "../config/index.js";
import { CommandError, type RunResult, type Runner } from "../runtime/index.js";
import type { WatchClock } from "./fail-fast.js";

const quiet: RunResult = { stdout: "", stderr: "", code: 0 };

/** A repository whose environment and catalog hold only what the unit reads. */
export function repositoryOf(
  environment: Partial<Environment> = {},
  components: Component[] = [],
): Repository {
  return {
    environment: {
      name: "local",
      kubeContext: "k3d-kore-local",
      provider: "k3d",
      ...environment,
    },
    catalog: { components },
  } as Repository;
}

/** A Helm component in its own namespace, unless the overrides say otherwise. */
export function componentOf(
  name: string,
  overrides: Partial<Component> = {},
): Component {
  return {
    name,
    phase: "platform",
    namespace: `${name}-ns`,
    kind: "helm",
    version: "1.0.0",
    ownsCRDs: [],
    dependencies: [],
    timeout: "5m",
    readiness: [],
    ...overrides,
  } as Component;
}

/** A runner whose replies come from `reply`; each call is recorded on `run`. */
export function runnerFake(
  reply: (command: string, args: readonly string[]) => RunResult = () => quiet,
) {
  const run = vi.fn<Runner["run"]>(async (command, args) =>
    reply(command, args),
  );
  return { run, runner: { run } satisfies Runner };
}

/** An approved image, or a seed when `seed` is set, with plain evidence. */
export function approvedEntryOf(image: string, seed = false): ApprovedEntry {
  return {
    name: image.slice(image.lastIndexOf("/") + 1),
    image,
    seed,
    evidence: {
      method: "cosign",
      source: "upstream",
      checked: "2026-11-01",
      provenance: { signed: false },
    },
  };
}

/** A runner that answers every call with this stdout and exit code 0. */
export function replyingWith(stdout: string) {
  return runnerFake(() => ({ stdout, stderr: "", code: 0 }));
}

/** A runner whose every call throws `error`. */
export function failingWith(error: Error) {
  return runnerFake(() => {
    throw error;
  });
}

/** A failed kubectl command with this stderr, as the runner throws it. */
export function commandFailure(stderr: string): CommandError {
  return new CommandError("kubectl", ["get"], { stdout: "", stderr, code: 1 });
}

/** The gate as the cluster returns it, for a generation and state. */
export function gateJson(generation: string, state: string): string {
  return JSON.stringify({ spec: { parameters: { generation, state } } });
}

/** The gate parameters of the body a test's apply call sent. */
export function appliedParameters(run: { mock: { calls: unknown[][] } }) {
  const options = run.mock.calls[0]?.[2] as { input?: string } | undefined;
  return (
    JSON.parse(options?.input ?? "{}") as {
      spec: { parameters: Record<string, unknown> };
    }
  ).spec.parameters;
}

/** A fake clock: each look advances time by the interval, and `looked(n)` settles once n looks have run. */
export function watchClock() {
  let now = 0;
  let looks = 0;
  const waiting: { at: number; resolve: () => void }[] = [];
  const clock: WatchClock = {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
      looks += 1;
      for (const wait of waiting) {
        if (looks >= wait.at) {
          wait.resolve();
        }
      }
    },
  };
  return {
    clock,
    looked: (at: number) =>
      new Promise<void>((resolve) => {
        waiting.push({ at, resolve });
      }),
  };
}
