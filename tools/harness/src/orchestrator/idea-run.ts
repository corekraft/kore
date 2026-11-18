import type { SendBackCategory } from "../ledger/index.js";
import type { OUTCOME_SOURCES } from "../outcome/index.js";
import type { QueueItem } from "../queue/index.js";

/** Writer and judge rounds one idea may take before the run stops and leaves it to a person. */
export const MAX_ROUNDS = 6;

/**
 * A pane to start; the writer gets a worktree, and `model` is set only on an escalation relaunch.
 * A judgment pane (ADR 0121) and the reader panes it asks for are started by the tick, never by a pane.
 */
export interface Launch {
  role: "writer" | "judge" | "judgment" | "reader";
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
  source: (typeof OUTCOME_SOURCES)[number];
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

/** The escalation a writer has reached: whether its PR was escalated, and the model its relaunch uses. */
export interface Escalation {
  escalated: boolean;
  model: string | undefined;
}

type QueuedIdea = Extract<QueueItem, { kind: "idea" }>;

/** The pane stage: spawn, wait for its result, then close it, so no pane is left running. */
export async function runPane(
  harness: Harness,
  launch: Launch,
): Promise<"done" | "blocked"> {
  await harness.spawn(launch);
  const outcome = await harness.wait(launch.name);
  await harness.close(launch.name);
  return outcome;
}

/** The writer's pane: a worktree and the brief to deliver the idea as one pull request; `name` overrides the default for a relaunch. */
export function writerLaunch(
  idea: string,
  issue: number,
  model: string | undefined,
  name: string = `idea-${idea}-writer`,
): Launch {
  return {
    role: "writer",
    name,
    issue,
    worktree: true,
    ...(model === undefined ? {} : { model }),
    brief: `Deliver idea ${idea} (issue #${issue}) as one pull request that says \`Refs #${issue}\`. Do not merge.`,
  };
}

/** The judge's pane for a pull request; `name` overrides the default so a tick can key it on the head. */
export function judgeLaunch(
  idea: string,
  pr: number,
  issue: number,
  name: string = `idea-${idea}-judge`,
): Launch {
  return {
    role: "judge",
    name,
    issue,
    brief: `Judge PR #${pr} for idea ${idea} (issue #${issue}): run the precheck, then approve and merge it, or send it back with the reason.`,
  };
}

/** The writer stage: runs the writer in a worktree; the PR it left, or undefined when it blocked or opened none. */
export async function writerStage(
  harness: Harness,
  idea: string,
  issue: number,
  model: string | undefined,
): Promise<number | undefined> {
  const outcome = await runPane(harness, writerLaunch(idea, issue, model));
  return outcome === "done" ? (await harness.delivery(issue)).pr : undefined;
}

/** The review stage: the Reviewer posts its verdict for the PR's head; throws when it posts none. */
export async function reviewStage(
  harness: Pick<Harness, "review">,
  pr: number,
): Promise<void> {
  await harness.review(pr);
}

/** The precheck stage: read-only; whether the writer must fix the change before any judge pane. */
export function precheckStage(
  harness: Pick<Harness, "precheck">,
  pr: number,
): Promise<PrecheckVerdict> {
  return harness.precheck(pr);
}

/** The send-back stage: posts the reason on the PR and records the send-back with its category. */
export async function sendBackStage(
  harness: Pick<Harness, "sendBack">,
  pr: number,
  reason: string,
  category: SendBackCategory,
): Promise<void> {
  await harness.sendBack(pr, reason, category);
}

/** The judge stage: runs the judge pane for the PR; whether the PR has merged. */
export async function judgeStage(
  harness: Harness,
  idea: string,
  pr: number,
  issue: number,
): Promise<boolean> {
  await runPane(harness, judgeLaunch(idea, pr, issue));
  return (await harness.delivery(issue)).merged;
}

/** The escalation stage: after a send-back, reads the PR's tier; escalates the PR once and takes the tier's model. */
export async function escalateStage(
  harness: Pick<Harness, "sendBacks" | "escalate">,
  pr: number,
  state: Escalation,
): Promise<Escalation> {
  const tier = await harness.sendBacks(pr);
  if (!tier.escalate) {
    return state;
  }
  if (!state.escalated) {
    await harness.escalate(pr);
  }
  return { escalated: true, model: tier.model };
}

/** The queue stage: reads the queue; the idea's queued item, or undefined when it is not queued. */
export async function queueStage(
  harness: Harness,
  idea: string,
): Promise<QueuedIdea | undefined> {
  return (await harness.queue()).find(
    (item): item is QueuedIdea => item.kind === "idea" && item.idea === idea,
  );
}

/** The outcome stage: writes the measured outcome, which closes the idea's issue. */
export async function outcomeStage(
  harness: Pick<Harness, "recordOutcome">,
  idea: string,
  outcome: Measured,
): Promise<void> {
  await harness.recordOutcome(idea, outcome);
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
    const queued = await queueStage(this.harness, idea);
    if (queued === undefined) {
      return { status: "not-queued", rounds: 0 };
    }
    let escalation: Escalation = { escalated: false, model: undefined };
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const pr = await writerStage(
        this.harness,
        idea,
        queued.issue,
        escalation.model,
      );
      if (pr === undefined) {
        return { status: "blocked", rounds: round };
      }
      if (!(await this.judge(idea, pr, queued.issue))) {
        escalation = await escalateStage(this.harness, pr, escalation);
        // Between pieces of work: no pane is running now.
        await queueStage(this.harness, idea);
        continue;
      }
      if (outcome === undefined) {
        return { status: "awaiting-outcome", rounds: round };
      }
      await outcomeStage(this.harness, idea, outcome);
      return { status: "outcome-recorded", rounds: round };
    }
    return { status: "gave-up", rounds: MAX_ROUNDS };
  }

  /** Runs the review and the precheck, then the judge on a pass; whether the PR merged. A failing precheck launches no judge. */
  private async judge(
    idea: string,
    pr: number,
    issue: number,
  ): Promise<boolean> {
    // The precheck reads the posted verdict, so the head is reviewed first.
    await reviewStage(this.harness, pr);
    const verdict = await precheckStage(this.harness, pr);
    if (verdict.sendBack) {
      await sendBackStage(this.harness, pr, verdict.reason, verdict.category);
      return false;
    }
    return judgeStage(this.harness, idea, pr, issue);
  }
}
