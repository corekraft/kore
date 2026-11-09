import {
  CommandError,
  type RunOptions,
  type RunResult,
  type Runner,
} from "../runtime/index.js";
import { loadRepository } from "../config/index.js";
import type { WatchClock } from "./fail-fast.js";
import { reconcileComponent } from "./reconcile.js";

export async function oci() {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(
    ({ name }) => name === "oci-registry",
  )!;
  return { repository, component };
}

export async function reconcile(scenario: Scenario): Promise<void> {
  const { repository, component } = await oci();
  await reconcileComponent(repository, scenario, component, undefined, {
    clock: scenario.clock,
    intervalMs: 5000,
    graceMs: 60000,
  });
}

export interface Pod {
  name: string;
  labels?: Record<string, string>;
  nodeName?: string | undefined;
  phase?: string;
  containers?: object[];
  initContainers?: object[];
}

export const crashLoop = (restarts: number) => ({
  name: "registry",
  restartCount: restarts,
  state: {
    waiting: { reason: "CrashLoopBackOff", message: "back-off restarting" },
  },
  lastState: {
    terminated: { reason: "Error", exitCode: 1, message: "exit 1" },
  },
});
export const waiting = (reason: string, message = "") => ({
  name: "registry",
  restartCount: 0,
  state: { waiting: { reason, message } },
});

export const pod = (extra: Partial<Pod> = {}): Pod => ({
  name: "oci-registry-x",
  labels: { "app.kubernetes.io/instance": "oci-registry" },
  nodeName: "node-1",
  ...extra,
});

export function podList(pods: Pod[]): string {
  return JSON.stringify({
    items: pods.map((p) => ({
      metadata: { name: p.name, labels: p.labels ?? {} },
      spec: p.nodeName ? { nodeName: p.nodeName } : {},
      status: {
        phase: p.phase ?? "Running",
        containerStatuses: p.containers ?? [],
        initContainerStatuses: p.initContainers ?? [],
      },
    })),
  });
}

export interface FakeEvent {
  reason: string;
  message: string;
  count?: number;
  pod?: string;
  /** ISO time of the latest occurrence; later events are more recent. */
  lastTimestamp?: string;
}

const hex = (seed: number) =>
  (
    seed.toString(16).padStart(2, "0") +
    "c0b65595e60de7f99d7829ab2aea321ddcd5ef24649755d5707c665c262d724"
  ).slice(0, 64);

/** Live shape: each attempt carries its own sandbox ID, so every event has count 1. */
export const liveSandboxOom = (attempt: number): FakeEvent => ({
  reason: "FailedCreatePodSandBox",
  count: 1,
  lastTimestamp: `2026-11-08T10:00:${String(attempt).padStart(2, "0")}Z`,
  message: `Failed to create pod sandbox: rpc error: code = Unknown desc = failed to start sandbox "${hex(attempt)}": failed to start sandbox container task "${hex(attempt)}": cannot start a container that has already stopped: unknown\n\n  context: runc create failed: unable to start container process: container init was OOM-killed (memory limit too low?)`,
});

/** Live shape when the CNI plugin is what fails. */
export const liveCniFailure = (attempt: number): FakeEvent => ({
  reason: "FailedCreatePodSandBox",
  count: 1,
  lastTimestamp: `2026-11-08T10:01:${String(attempt).padStart(2, "0")}Z`,
  message: `Failed to create pod sandbox: rpc error: code = Unknown desc = failed to setup network for sandbox "${hex(attempt)}": plugin type="istio-cni" name="istio-cni" failed (add): unable to reach istio-cni node agent`,
});

/** The probe's event: a 4Mi limit OOM-kills the sandbox's init, over and over. */
export const sandboxOom = (count: number): FakeEvent => ({
  reason: "FailedCreatePodSandBox",
  count,
  message:
    "Failed to create pod sandbox: rpc error: code = Unknown desc = failed to start sandbox: container init was OOM-killed (memory limit too low?)",
});

export interface ScenarioOptions {
  /** Events in the namespace at a tick (default: one FailedScheduling). */
  events?: (tick: number) => FakeEvent[];
  /** Helm itself gives up at this tick, as on its own timeout. */
  helmFailsAtTick?: number;
}

export const SCHEDULING_MESSAGE =
  "0/1 nodes are available: 1 node(s) didn't match pod anti-affinity rules.";
export const LOGS = [
  "starting registry",
  "listen tcp :5001: bind: address already in use",
].join("\n");

/** Scripted cluster: `pods(tick)` is what the namespace holds at that tick. */
export class Scenario implements Runner {
  calls: { command: string; args: readonly string[] }[] = [];
  aborts = 0;
  ticks = 0;
  now = 0;
  private waiters: (() => void)[] = [];
  constructor(
    private readonly pods: (tick: number) => Pod[],
    private readonly helmFinishesAtTick?: number,
    private readonly options: ScenarioOptions = {},
  ) {}

  readonly clock: WatchClock = {
    now: () => this.now,
    sleep: async (ms, signal) => {
      if (signal.aborted) {
        return;
      }
      this.now += ms;
      this.ticks += 1;
      for (const wake of this.waiters.splice(0)) {
        wake();
      }
      await new Promise((resolve) => setImmediate(resolve));
    },
  };

  async run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push({ command, args });
    const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", code: 0 });
    if (command === "helm" && args[0] === "upgrade") {
      return await this.helm(args, options);
    }
    if (command !== "kubectl") {
      return ok("[]");
    }
    if (args.includes("pods")) {
      return ok(podList(this.pods(this.ticks)));
    }
    if (args.includes("events")) {
      const events = this.options.events?.(this.ticks) ?? [
        { reason: "FailedScheduling", message: SCHEDULING_MESSAGE },
      ];
      return ok(
        JSON.stringify({
          items: events.map((event) => ({
            reason: event.reason,
            message: event.message,
            count: event.count ?? 1,
            lastTimestamp: event.lastTimestamp,
            involvedObject: {
              kind: "Pod",
              name: event.pod ?? "oci-registry-x",
            },
          })),
        }),
      );
    }
    if (args.includes("logs")) {
      return ok(LOGS);
    }
    if (args.some((arg) => arg.includes("availableReplicas"))) {
      return ok("available"); // the Deployment is up once Helm finishes
    }
    return ok();
  }

  private async helm(
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    const failed = () =>
      this.options.helmFailsAtTick !== undefined &&
      this.ticks >= this.options.helmFailsAtTick;
    const finished = () =>
      this.helmFinishesAtTick !== undefined &&
      this.ticks >= this.helmFinishesAtTick;
    return await new Promise((resolve, reject) => {
      const settle = () => {
        if (failed()) {
          reject(
            new CommandError("helm", args, {
              stdout: "",
              stderr:
                "UPGRADE FAILED: resource Deployment/x not ready. context deadline exceeded",
              code: 1,
            }),
          );
          return true;
        }
        if (finished()) {
          resolve({ stdout: "", stderr: "", code: 0 });
          return true;
        }
        return false;
      };
      options?.signal?.addEventListener("abort", () => {
        this.aborts += 1;
        reject(
          new CommandError("helm", args, {
            stdout: "",
            stderr: "interrupted",
            code: 1,
          }),
        );
      });
      const wait = () => {
        if (!settle()) {
          this.waiters.push(wait);
        }
      };
      wait();
    });
  }
}
