import type { SendBackCategory } from "../ledger/index.js";
import type { QueueItem } from "../queue/index.js";

/** Writer and judge rounds one idea may take before the run stops and leaves it to a person. */
export const MAX_ROUNDS = 6;

/** A pane to start; the writer gets a worktree, and `model` is set only on an escalation relaunch. */
export interface Launch {
  role: "writer" | "judge";
  name: string;
  brief: string;
  /** The idea's issue number, which `session spawn --idea` stamps into the pane for the ledger. */
  issue: number;
  worktree?: true;
  model?: string;
}

/** What gh says about the idea's pull request: absent until a writer opens one. */
export interface Delivery {
  pr?: number;
  merged: boolean;
}

/** The measured outcome the run records once the change has merged. */
export interface Measured {
  kind: "experiment" | "usage" | "verification";
  source: "live-run" | "journal" | "eval-history" | "comparison";
  result: "confirmed" | "refuted" | "inconclusive";
  evidence: string;
  summary: string;
}

/** The precheck's call on a change: send it back to its writer with a reason, or let the judge run. */
export type PrecheckVerdict =
  | { sendBack: false }
  | { sendBack: true; reason: string; category: SendBackCategory };

export interface SendBackTier {
  count: number;
  model: string;
  escalate: boolean;
}

/** Every side effect the orchestrator has, each one an existing harness tool; faked in specs. */
export interface Harness {
  /** `queue next`: read-only. */
  queue(): Promise<QueueItem[]>;
  /** `session spawn --no-wait`. */
  spawn(launch: Launch): Promise<void>;
  /** `session wait`: the recorded result of the pane. */
  wait(name: string): Promise<"done" | "blocked">;
  /** `session close`. */
  close(name: string): Promise<void>;
  /** The idea's pull request and whether the judge has merged it; read-only. */
  delivery(issue: number): Promise<Delivery>;
  /** `review run`: spawns the Reviewer for the PR's head and posts its verdict; throws when it posts none. */
  review(pr: number): Promise<void>;
  /** `judge precheck`: read-only; whether the writer must fix the change before any judge pane. */
  precheck(pr: number): Promise<PrecheckVerdict>;
  /** `judge send-back`: posts the reason on the PR and records the send-back event with its category, keyed on the PR head. */
  sendBack(
    pr: number,
    reason: string,
    category: SendBackCategory,
  ): Promise<void>;
  /** `queue send-backs`: read-only. */
  sendBacks(pr: number): Promise<SendBackTier>;
  /** `queue escalate`: appends the escalation event. */
  escalate(pr: number): Promise<void>;
  /** `outcome record`: writes the outcome and closes the idea's issue. */
  recordOutcome(idea: string, outcome: Measured): Promise<void>;
}

export type RunStatus =
  | "outcome-recorded"
  | "awaiting-outcome"
  | "not-queued"
  | "blocked"
  | "gave-up";

export interface RunResult {
  status: RunStatus;
  rounds: number;
}

/**
 * Drives one approved idea to an outcome: a writer, then a judge, repeated while
 * the judge sends the change back. A failing precheck sends the change back
 * itself, before any judge pane. It reads the queue only between pieces of work,
 * escalates the writer after two send-backs, and never merges or edits: the judge merges, and only a given outcome closes the idea.
 */
export class IdeaRun {
  /** `betweenWork` runs once when a queued idea's run ends, after every pane is closed. */
  constructor(
    private readonly harness: Harness,
    private readonly betweenWork?: () => Promise<void>,
  ) {}

  async run(idea: string, outcome: Measured | undefined): Promise<RunResult> {
    const result = await this.drive(idea, outcome);
    if (result.status !== "not-queued") {
      await this.betweenWork?.();
    }
    return result;
  }

  private async drive(
    idea: string,
    outcome: Measured | undefined,
  ): Promise<RunResult> {
    const queued = (await this.harness.queue()).find(
      (item) => item.kind === "idea" && item.idea === idea,
    );
    if (queued?.kind !== "idea") {
      return { status: "not-queued", rounds: 0 };
    }
    let model: string | undefined;
    let escalated = false;
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const pr = await this.write(idea, queued.issue, model);
      if (pr === undefined) {
        return { status: "blocked", rounds: round };
      }
      if (!(await this.judge(idea, pr, queued.issue))) {
        const tier = await this.harness.sendBacks(pr);
        if (tier.escalate) {
          if (!escalated) {
            await this.harness.escalate(pr);
            escalated = true;
          }
          model = tier.model;
        }
        // Between pieces of work: no pane is running now.
        await this.harness.queue();
        continue;
      }
      if (outcome === undefined) {
        return { status: "awaiting-outcome", rounds: round };
      }
      await this.harness.recordOutcome(idea, outcome);
      return { status: "outcome-recorded", rounds: round };
    }
    return { status: "gave-up", rounds: MAX_ROUNDS };
  }

  /** Runs a writer to its result; the PR it left, or undefined when it blocked or opened none. */
  private async write(
    idea: string,
    issue: number,
    model: string | undefined,
  ): Promise<number | undefined> {
    const name = `idea-${idea}-writer`;
    const outcome = await this.pane({
      role: "writer",
      name,
      issue,
      worktree: true,
      ...(model === undefined ? {} : { model }),
      brief: `Deliver idea ${idea} (issue #${issue}) as one pull request that says \`Refs #${issue}\`. Do not merge.`,
    });
    return outcome === "done"
      ? (await this.harness.delivery(issue)).pr
      : undefined;
  }

  /** Runs the review and the precheck, then the judge on a pass; whether the PR merged. A failing precheck launches no judge. */
  private async judge(
    idea: string,
    pr: number,
    issue: number,
  ): Promise<boolean> {
    // The precheck reads the posted verdict, so the head is reviewed first.
    await this.harness.review(pr);
    const verdict = await this.harness.precheck(pr);
    if (verdict.sendBack) {
      await this.harness.sendBack(pr, verdict.reason, verdict.category);
      return false;
    }
    await this.pane({
      role: "judge",
      name: `idea-${idea}-judge`,
      issue,
      brief: `Judge PR #${pr} for idea ${idea} (issue #${issue}): run the precheck, then approve and merge it, or send it back with the reason.`,
    });
    return (await this.harness.delivery(issue)).merged;
  }

  private async pane(launch: Launch): Promise<"done" | "blocked"> {
    await this.harness.spawn(launch);
    const outcome = await this.harness.wait(launch.name);
    await this.harness.close(launch.name);
    return outcome;
  }
}
