import type { QueueItem } from "../queue/index.js";
import type { Runner } from "../runtime/index.js";
import type { RetroPane, RetroReport } from "./retro-launch.js";
import type {
  Delivery,
  Harness,
  Launch,
  Measured,
  PrecheckVerdict,
  SendBackTier,
} from "./idea-run.js";
import { sendBackReason, type PrecheckReport } from "./precheck-reason.js";

export class HarnessCliError extends Error {}

const HARNESS = "skills/bin/harness.mjs";

/** The Harness port over the real tools: every call is one `harness` or `gh` command through the runner. */
export class HarnessCli implements Harness {
  constructor(
    private readonly runner: Runner,
    private readonly root: string,
  ) {}

  async queue(): Promise<QueueItem[]> {
    const read = this.json(await this.harness("queue", "next", "--json"));
    return (read as { queue: QueueItem[] }).queue;
  }

  async spawn(launch: Launch): Promise<void> {
    await this.harness(
      "session",
      "spawn",
      "--role",
      launch.role,
      "--name",
      launch.name,
      "--brief",
      launch.brief,
      "--idea",
      String(launch.issue),
      "--no-wait",
      ...(launch.worktree === true ? ["--worktree"] : []),
      ...(launch.model === undefined ? [] : ["--model", launch.model]),
    );
  }

  async wait(name: string): Promise<"done" | "blocked"> {
    const waited = this.json(
      await this.harness("session", "wait", name, "--json"),
    ) as { outcome: "done" | "blocked" };
    return waited.outcome;
  }

  async close(name: string): Promise<void> {
    await this.harness("session", "close", name);
  }

  async delivery(issue: number): Promise<Delivery> {
    const done = await this.runner.run(
      "gh",
      [
        "pr",
        "list",
        "--state",
        "all",
        "--search",
        `Refs #${issue} in:body`,
        "--json",
        "number,mergedAt",
      ],
      { cwd: this.root },
    );
    this.check("gh pr list", done);
    const prs = this.json(done.stdout) as {
      number: number;
      mergedAt: string | null;
    }[];
    const newest = prs.reduce<(typeof prs)[number] | undefined>(
      (best, pr) => (best === undefined || pr.number > best.number ? pr : best),
      undefined,
    );
    return newest === undefined
      ? { merged: false }
      : { pr: newest.number, merged: newest.mergedAt !== null };
  }

  /**
   * `judge precheck --json`: read-only. It exits 1 on a report that is not ready,
   * so the report is read whatever the code; no report means the precheck itself failed.
   */
  async precheck(pr: number): Promise<PrecheckVerdict> {
    const done = await this.runner.run(
      "node",
      [HARNESS, "judge", "precheck", String(pr), "--json"],
      { cwd: this.root },
    );
    let report: PrecheckReport;
    try {
      report = JSON.parse(done.stdout) as PrecheckReport;
    } catch {
      this.check(`harness judge precheck ${pr}`, {
        ...done,
        code: done.code || 1,
      });
      throw new HarnessCliError(
        "A harness tool printed unreadable output; rerun the command.",
      );
    }
    const reason = sendBackReason(report);
    return reason === undefined
      ? { sendBack: false }
      : { sendBack: true, reason };
  }

  /** `judge send-back`: comments the reason on the PR and records the event with the PR head in its label. */
  async sendBack(pr: number, reason: string): Promise<void> {
    await this.harness("judge", "send-back", String(pr), "--reason", reason);
  }

  async sendBacks(pr: number): Promise<SendBackTier> {
    const tier = this.json(
      await this.harness("queue", "send-backs", String(pr), "--json"),
    ) as SendBackTier;
    return { count: tier.count, model: tier.model, escalate: tier.escalate };
  }

  async escalate(pr: number): Promise<void> {
    await this.harness("queue", "escalate", String(pr));
  }

  async recordOutcome(idea: string, outcome: Measured): Promise<void> {
    await this.harness(
      "outcome",
      "record",
      "--idea",
      idea,
      "--kind",
      outcome.kind,
      "--source",
      outcome.source,
      "--result",
      outcome.result,
      "--evidence",
      outcome.evidence,
      "--summary",
      outcome.summary,
    );
  }

  /** `retro due --json`: read-only. */
  async retroDue(): Promise<RetroReport> {
    const read = this.json(await this.harness("retro", "due", "--json")) as {
      due: boolean;
      reason?: "count" | "metric";
      metric?: string;
    };
    return read.due && read.reason !== undefined
      ? {
          due: true,
          reason: read.reason,
          ...(read.metric === undefined ? {} : { metric: read.metric }),
        }
      : { due: false };
  }

  /** `retro record`: the owning script writes the ledger event and the marker. */
  async retroRecord(
    reason: string,
  ): Promise<{ recordedAt: string; appended: boolean }> {
    const done = this.json(
      await this.harness("retro", "record", "--reason", reason, "--json"),
    ) as { recordedAt: string; appended: boolean };
    return { recordedAt: done.recordedAt, appended: done.appended };
  }

  /** `session spawn --no-wait` for the retro pane, on the model it names. */
  async spawnRetro(pane: RetroPane): Promise<void> {
    await this.harness(
      "session",
      "spawn",
      "--role",
      pane.role,
      "--name",
      pane.name,
      "--brief",
      pane.brief,
      "--model",
      pane.model,
      "--no-wait",
    );
  }

  private async harness(...args: string[]): Promise<string> {
    const done = await this.runner.run("node", [HARNESS, ...args], {
      cwd: this.root,
    });
    this.check(`harness ${args.filter((a) => a !== "--json").join(" ")}`, done);
    return done.stdout;
  }

  private check(what: string, done: { code: number; stderr: string }): void {
    if (done.code !== 0) {
      throw new HarnessCliError(
        `\`${what}\` failed: ${done.stderr.trim() || "no output"}. Fix that, then rerun.`,
      );
    }
  }

  private json(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new HarnessCliError(
        "A harness tool printed unreadable output; rerun the command.",
      );
    }
  }
}
