import type { QueueItem } from "../queue/index.js";
import {
  escalateStage,
  judgeLaunch,
  outcomeStage,
  precheckStage,
  reviewStage,
  sendBackStage,
  writerLaunch,
  type Harness,
  type Measured,
} from "./idea-run.js";

/** A third send-back goes to a judgment pane (idea 0007), which a later step adds; the tick starts none. */
const JUDGMENT_AFTER = 3;
const HEAD_LENGTH = 7;

export type PaneState = "running" | "done" | "blocked" | "closed";

/** One pane `session spawn` made for an idea, read from the session registry. */
export interface IdeaPane {
  name: string;
  state: PaneState;
}

/** What the tick reads and does: the stage ports of `orchestrate run`, plus three non-blocking reads. */
export type TickPorts = Pick<
  Harness,
  | "queue"
  | "spawn"
  | "close"
  | "delivery"
  | "review"
  | "precheck"
  | "sendBack"
  | "sendBacks"
  | "escalate"
  | "recordOutcome"
> & {
  /** Every pane the idea has had, running or finished; read-only. */
  panes(idea: string): Promise<IdeaPane[]>;
  /** The pull request's head commit; read-only. */
  head(pr: number): Promise<string>;
  /** Whether a principles-review verdict is already posted for the head; read-only. */
  reviewPosted(pr: number, head: string): Promise<boolean>;
};

export type StepName =
  | "spawn-writer"
  | "relaunch-writer"
  | "spawn-judge"
  | "review"
  | "send-back"
  | "close"
  | "record-outcome"
  | "waiting"
  | "blocked"
  | "awaiting-judge"
  | "awaiting-outcome"
  | "needs-judgment"
  | "not-queued";

/** The one step a pass took for an idea. */
export interface IdeaStep {
  idea: string;
  issue?: number;
  step: StepName;
  pr?: number;
  pane?: string;
}

type QueuedIdea = Extract<QueueItem, { kind: "idea" }>;

/**
 * One idempotent pass over the queue. Each queued idea advances by at most one
 * step, decided from what is already recorded (its panes, its pull request and
 * the head's verdicts), so a rerun finds the last step done and takes the next.
 * A pane is named for its idea and the head it works at, so a rerun never starts
 * one twice. The tick merges and edits nothing, and calls no model.
 */
export class Tick {
  constructor(
    private readonly ports: TickPorts,
    /** The measured outcome to record for an idea once its change has merged. */
    private readonly outcomes: ReadonlyMap<string, Measured> = new Map(),
  ) {}

  /** Advances every queued idea, or only `only` when given. */
  async pass(only?: string): Promise<IdeaStep[]> {
    const queue = await this.ports.queue();
    const ideas = queue.filter(
      (item): item is QueuedIdea =>
        item.kind === "idea" && (only === undefined || item.idea === only),
    );
    const steps: IdeaStep[] = [];
    for (const item of ideas) {
      steps.push(await this.advance(item, queue));
    }
    if (only !== undefined && ideas.length === 0) {
      steps.push({ idea: only, step: "not-queued" });
    }
    return steps;
  }

  private async advance(
    item: QueuedIdea,
    queue: readonly QueueItem[],
  ): Promise<IdeaStep> {
    const { idea, issue } = item;
    const done = (
      step: StepName,
      extra: Pick<IdeaStep, "pr" | "pane"> = {},
    ): IdeaStep => ({ idea, issue, step, ...extra });
    const panes = await this.ports.panes(idea);
    if (panes.some((p) => p.state === "running")) {
      return done("waiting");
    }
    const finished = panes.find((p) => p.state !== "closed");
    if (finished !== undefined) {
      await this.ports.close(finished.name);
      return done("close", { pane: finished.name });
    }
    const delivery = await this.ports.delivery(issue);
    if (delivery.pr === undefined) {
      return this.firstWriter(item, panes, done);
    }
    const pr = delivery.pr;
    if (delivery.merged) {
      return this.merged(item, pr, done);
    }
    const head = (await this.ports.head(pr)).slice(0, HEAD_LENGTH);
    const sentBack = queue.some((q) => q.kind === "send-back" && q.pr === pr);
    return sentBack
      ? this.relaunch(item, pr, head, panes, done)
      : this.review(item, pr, head, panes, done);
  }

  private async firstWriter(
    { idea, issue }: QueuedIdea,
    panes: readonly IdeaPane[],
    done: (step: StepName) => IdeaStep,
  ): Promise<IdeaStep> {
    // A writer that already ran and left no pull request is for a person, not a second writer.
    if (panes.some((p) => p.name === `idea-${idea}-writer`)) {
      return done("blocked");
    }
    await this.ports.spawn(writerLaunch(idea, issue, undefined));
    return done("spawn-writer");
  }

  private async merged(
    { idea }: QueuedIdea,
    pr: number,
    done: (step: StepName, extra: { pr: number }) => IdeaStep,
  ): Promise<IdeaStep> {
    const outcome = this.outcomes.get(idea);
    if (outcome === undefined) {
      return done("awaiting-outcome", { pr });
    }
    await outcomeStage(this.ports, idea, outcome);
    return done("record-outcome", { pr });
  }

  private async relaunch(
    { idea, issue }: QueuedIdea,
    pr: number,
    head: string,
    panes: readonly IdeaPane[],
    done: (step: StepName, extra: Pick<IdeaStep, "pr" | "pane">) => IdeaStep,
  ): Promise<IdeaStep> {
    const name = `idea-${idea}-writer-${head}`;
    if (panes.some((p) => p.name === name)) {
      return done("blocked", { pr });
    }
    const tier = await this.ports.sendBacks(pr);
    if (tier.count >= JUDGMENT_AFTER) {
      return done("needs-judgment", { pr });
    }
    const escalation = await escalateStage(this.ports, pr, {
      escalated: false,
      model: undefined,
    });
    await this.ports.spawn(writerLaunch(idea, issue, escalation.model, name));
    return done("relaunch-writer", { pr, pane: name });
  }

  private async review(
    { idea, issue }: QueuedIdea,
    pr: number,
    head: string,
    panes: readonly IdeaPane[],
    done: (step: StepName, extra: Pick<IdeaStep, "pr" | "pane">) => IdeaStep,
  ): Promise<IdeaStep> {
    const name = `idea-${idea}-judge-${head}`;
    if (panes.some((p) => p.name === name)) {
      return done("awaiting-judge", { pr });
    }
    if (!(await this.ports.reviewPosted(pr, head))) {
      await reviewStage(this.ports, pr);
      return done("review", { pr });
    }
    const verdict = await precheckStage(this.ports, pr);
    if (verdict.sendBack) {
      await sendBackStage(this.ports, pr, verdict.reason, verdict.category);
      return done("send-back", { pr });
    }
    await this.ports.spawn(judgeLaunch(idea, pr, issue, name));
    return done("spawn-judge", { pr, pane: name });
  }
}
