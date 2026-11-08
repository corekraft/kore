import {
  CommandError,
  type RunOptions,
  type RunResult,
  type Runner,
} from "../runtime/index.js";
import type { WatchClock } from "./fail-fast.js";

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
      return ok(
        JSON.stringify({
          items: [
            {
              reason: "FailedScheduling",
              message: SCHEDULING_MESSAGE,
              involvedObject: { kind: "Pod", name: "oci-registry-x" },
            },
          ],
        }),
      );
    }
    if (args.includes("logs")) {
      return ok(LOGS);
    }
    return ok();
  }

  private async helm(
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    const finished = () =>
      this.helmFinishesAtTick !== undefined &&
      this.ticks >= this.helmFinishesAtTick;
    return await new Promise((resolve, reject) => {
      const settle = () => {
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
