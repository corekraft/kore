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
import { OPEN_GATE, type BoundName, type PassGate } from "./tick-bounds.js";
import {
  TickJudgment,
  type JudgmentOutcome,
  type JudgmentPorts,
  type JudgmentStep,
} from "./tick-judgment.js";
import type { TickNotifier } from "./tick-notify.js";
import type { StoredPlan } from "./tick-plan-store.js";
import { nextPiece, pieceLaunch } from "./tick-piece.js";
import { Starts } from "./tick-starts.js";

/** A third send-back starts a judgment flow (ADR 0121), which decides once; the tick reports needs-judgment after that. */
const JUDGMENT_AFTER = 3;
const HEAD_LENGTH = 7;

/** The extra fields a judgment step adds to its idea's step: the pane it started, or the bound that held it. */
function judgedExtra(
  outcome: JudgmentOutcome,
): Partial<Pick<IdeaStep, "pane" | "bound">> {
  return {
    ...(outcome.pane === undefined ? {} : { pane: outcome.pane }),
    ...(outcome.bound === undefined ? {} : { bound: outcome.bound }),
  };
}

type Done = (
  step: StepName,
  extra?: Partial<Pick<IdeaStep, "pr" | "pane" | "bound">>,
) => IdeaStep;

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
  /** A finished pane's text, read before the pane is closed; read-only. */
  paneText(name: string): Promise<string>;
  /** Labels the issue `needs-info` with the reason, for a judgment flow that stops (ADR 0121). */
  needsInfo(issue: number, reason: string): Promise<void>;
  /** The idea's persisted work plan, read-only; undefined when the idea has none (ADR 0121). */
  workPlan(idea: string): Promise<StoredPlan | undefined>;
  /** Persists a checked work plan for the idea through `orchestrate plan`, once (ADR 0121). */
  persistPlan: JudgmentPorts["persistPlan"];
};

export type StepName =
  | "spawn-writer"
  | "relaunch-writer"
  | "spawn-judge"
  | "spawn-piece"
  | "review"
  | "send-back"
  | "close"
  | "record-outcome"
  | "waiting"
  | "blocked"
  | "awaiting-judge"
  | "awaiting-outcome"
  | "needs-judgment"
  | "not-queued"
  | "held"
  | JudgmentStep;

/** The one step a pass took for an idea. */
export interface IdeaStep {
  idea: string;
  issue?: number;
  step: StepName;
  pr?: number;
  pane?: string;
  /** On a held step: the bound that stopped the pane start this pass. */
  bound?: BoundName;
}

type QueuedIdea = Extract<QueueItem, { kind: "idea" }>;

/** The pull request an idea's pass works on, and the head commit it is at. */
interface Change {
  pr: number;
  head: string;
}

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
    /** The host bounds this pass reads, and where its bound hits are recorded. */
    private readonly gate: PassGate = OPEN_GATE,
    /** The judgment flow a third send-back starts and a finished judgment pane feeds (ADR 0121). */
    private readonly judgment: TickJudgment = new TickJudgment(ports),
    /** Told each step of a pass, so an idea that needs a person can reach the attended pane. */
    private readonly notifier: Pick<TickNotifier, "notify"> = {
      notify: async () => undefined,
    },
  ) {}

  /** Advances every queued idea, or only `only` when given. */
  async pass(only?: string): Promise<IdeaStep[]> {
    const queue = await this.ports.queue();
    const ideas = queue.filter(
      (item): item is QueuedIdea =>
        item.kind === "idea" && (only === undefined || item.idea === only),
    );
    const starts = new Starts(await this.gate.read(), this.gate);
    const steps: IdeaStep[] = [];
    for (const item of ideas) {
      const step = await this.advance(item, queue, starts);
      await this.notifier.notify(step);
      steps.push(step);
    }
    if (only !== undefined && ideas.length === 0) {
      steps.push({ idea: only, step: "not-queued" });
    }
    return steps;
  }

  private async advance(
    item: QueuedIdea,
    queue: readonly QueueItem[],
    starts: Starts,
  ): Promise<IdeaStep> {
    const { idea, issue } = item;
    const done: Done = (step, extra = {}) => ({ idea, issue, step, ...extra });
    const panes = await this.ports.panes(idea);
    if (panes.some((p) => p.state === "running")) {
      return done("waiting");
    }
    const planned = await this.planned(item, panes, done, starts);
    if (planned !== undefined) {
      return planned;
    }
    const finished = panes.find((p) => p.state !== "closed");
    if (finished !== undefined) {
      await this.ports.close(finished.name);
      return done("close", { pane: finished.name });
    }
    const delivery = await this.ports.delivery(issue);
    if (delivery.pr === undefined) {
      return this.firstWriter(item, panes, done, starts);
    }
    const pr = delivery.pr;
    if (delivery.merged) {
      return this.merged(item, pr, done);
    }
    const head = (await this.ports.head(pr)).slice(0, HEAD_LENGTH);
    const sentBack = queue.some((q) => q.kind === "send-back" && q.pr === pr);
    return sentBack
      ? this.relaunch(item, { pr, head }, panes, done, starts)
      : this.review(item, { pr, head }, panes, done, starts);
  }

  /**
   * The step a judgment flow or a persisted work plan takes before a finished pane is closed: a
   * judgment or reader pane is read before any close, since closing ends its text (ADR 0121).
   */
  private async planned(
    item: QueuedIdea,
    panes: readonly IdeaPane[],
    done: Done,
    starts: Starts,
  ): Promise<IdeaStep | undefined> {
    const { idea, issue } = item;
    const judged = await this.judgment.consume(idea, issue, panes, () =>
      starts.admit(issue),
    );
    if (judged !== undefined) {
      return done(judged.step, judgedExtra(judged));
    }
    return this.pieceStep(item, panes, done, starts);
  }

  /**
   * The idea's next piece of persisted work, as its one step. Undefined when the flow goes on past
   * the plan: a finished piece is closed first, and a complete plan hands the idea on (ADR 0121).
   */
  private async pieceStep(
    { idea, issue }: QueuedIdea,
    panes: readonly IdeaPane[],
    done: Done,
    starts: Starts,
  ): Promise<IdeaStep | undefined> {
    const plan = await this.ports.workPlan(idea);
    const next = nextPiece(idea, plan?.work ?? [], panes);
    if (next.step === "pass") {
      return undefined;
    }
    if (next.step === "blocked") {
      return done("blocked", { pane: next.name });
    }
    const bound = await starts.admit(issue);
    if (bound !== undefined) {
      return done("held", { bound });
    }
    await this.ports.spawn(pieceLaunch(idea, issue, next.piece, next.name));
    return done("spawn-piece", { pane: next.name });
  }

  private async firstWriter(
    { idea, issue }: QueuedIdea,
    panes: readonly IdeaPane[],
    done: Done,
    starts: Starts,
  ): Promise<IdeaStep> {
    // A writer that already ran and left no pull request is for a person, not a second writer.
    if (panes.some((p) => p.name === `idea-${idea}-writer`)) {
      return done("blocked");
    }
    const bound = await starts.held(issue);
    if (bound !== undefined) {
      return done("held", { bound });
    }
    await this.ports.spawn(writerLaunch(idea, issue, undefined));
    starts.taken();
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
    { pr, head }: Change,
    panes: readonly IdeaPane[],
    done: Done,
    starts: Starts,
  ): Promise<IdeaStep> {
    const name = `idea-${idea}-writer-${head}`;
    if (panes.some((p) => p.name === name)) {
      return done("blocked", { pr });
    }
    const tier = await this.ports.sendBacks(pr);
    if (tier.count >= JUDGMENT_AFTER) {
      // The flow decides once per idea; after that a person decides, so nothing else is started.
      if (this.judgment.begun(idea, panes)) {
        return done("needs-judgment", { pr });
      }
      const started = await this.judgment.begin(
        idea,
        issue,
        pr,
        tier.count,
        () => starts.admit(issue),
      );
      return done(started.step, { pr, ...judgedExtra(started) });
    }
    const bound = await starts.held(issue);
    if (bound !== undefined) {
      return done("held", { pr, bound });
    }
    const escalation = await escalateStage(this.ports, pr, {
      escalated: false,
      model: undefined,
    });
    await this.ports.spawn(writerLaunch(idea, issue, escalation.model, name));
    starts.taken();
    return done("relaunch-writer", { pr, pane: name });
  }

  private async review(
    { idea, issue }: QueuedIdea,
    { pr, head }: Change,
    panes: readonly IdeaPane[],
    done: Done,
    starts: Starts,
  ): Promise<IdeaStep> {
    const name = `idea-${idea}-judge-${head}`;
    if (panes.some((p) => p.name === name)) {
      return done("awaiting-judge", { pr });
    }
    if (!(await this.ports.reviewPosted(pr, head))) {
      const bound = await starts.held(issue);
      if (bound !== undefined) {
        return done("held", { pr, bound });
      }
      await reviewStage(this.ports, pr);
      starts.taken();
      return done("review", { pr });
    }
    const verdict = await precheckStage(this.ports, pr);
    if (verdict.sendBack) {
      await sendBackStage(this.ports, pr, verdict.reason, verdict.category);
      return done("send-back", { pr });
    }
    const bound = await starts.held(issue);
    if (bound !== undefined) {
      return done("held", { pr, bound });
    }
    await this.ports.spawn(judgeLaunch(idea, pr, issue, name));
    starts.taken();
    return done("spawn-judge", { pr, pane: name });
  }
}
