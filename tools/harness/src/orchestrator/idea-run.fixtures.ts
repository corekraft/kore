import type { QueueItem } from "../queue/index.js";
import type {
  Delivery,
  Harness,
  Launch,
  Measured,
  PrecheckVerdict,
} from "./idea-run.js";

export const IDEA: QueueItem = {
  kind: "idea",
  idea: "0042",
  issue: 197,
  since: "2026-01-01T00:00:00Z",
};
export const OUTCOME: Measured = {
  kind: "verification",
  source: "comparison",
  result: "confirmed",
  evidence: "PR #50",
  summary: "The fixture idea merged.",
};

/** A scripted Harness: records every call in order, answers from the script. */
export class ScriptedHarness implements Harness {
  readonly calls: string[] = [];
  readonly launches: Launch[] = [];
  readonly recorded: Measured[] = [];
  readonly reasons: string[] = [];
  private judged = 0;

  constructor(
    private readonly script: {
      queue?: QueueItem[];
      /** What `delivery` reports after each judge pane, in order. */
      deliveries?: Delivery[];
      waits?: ("done" | "blocked")[];
      counts?: number[];
      /** What `precheck` answers on each call, in order; a pass once the script runs out. */
      prechecks?: PrecheckVerdict[];
    } = {},
  ) {}

  queue(): Promise<QueueItem[]> {
    this.calls.push("queue");
    return Promise.resolve(this.script.queue ?? [IDEA]);
  }
  spawn(launch: Launch): Promise<void> {
    this.calls.push(`spawn ${launch.role}`);
    this.launches.push(launch);
    return Promise.resolve();
  }
  wait(name: string): Promise<"done" | "blocked"> {
    this.calls.push(`wait ${name}`);
    return Promise.resolve(this.script.waits?.shift() ?? "done");
  }
  close(name: string): Promise<void> {
    this.calls.push(`close ${name}`);
    return Promise.resolve();
  }
  delivery(): Promise<Delivery> {
    this.calls.push("delivery");
    const all = this.script.deliveries ?? [{ pr: 50, merged: true }];
    const at = Math.min(this.judged, all.length - 1);
    return Promise.resolve(all[at] ?? { merged: false });
  }
  precheck(pr: number): Promise<PrecheckVerdict> {
    this.calls.push(`precheck ${pr}`);
    return Promise.resolve(
      this.script.prechecks?.shift() ?? { sendBack: false },
    );
  }
  sendBack(pr: number, reason: string): Promise<void> {
    this.calls.push(`send-back ${pr}`);
    this.reasons.push(reason);
    return Promise.resolve();
  }
  sendBacks(pr: number) {
    this.calls.push(`send-backs ${pr}`);
    this.judged += 1;
    const count = this.script.counts?.shift() ?? 0;
    return Promise.resolve({
      count,
      escalate: count >= 2,
      model: count >= 2 ? "claude-sonnet-5-5" : "claude-haiku-5-5",
    });
  }
  escalate(pr: number): Promise<void> {
    this.calls.push(`escalate ${pr}`);
    return Promise.resolve();
  }
  recordOutcome(_idea: string, outcome: Measured): Promise<void> {
    this.calls.push("record-outcome");
    this.recorded.push(outcome);
    return Promise.resolve();
  }
}
