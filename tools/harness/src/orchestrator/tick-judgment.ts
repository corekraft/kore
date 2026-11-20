import type { PlanCheck, WorkPiece } from "./judgment-check.js";
import type { Delivery, Launch } from "./idea-run.js";
import { decide, type Next } from "./judgment-flow.js";
import {
  judgmentBrief,
  readerBrief,
  type ReaderSummary,
} from "./judgment-briefs.js";
import {
  flowOf,
  isFinished,
  isOpen,
  judgmentName,
  readerName,
  retryName,
  type Decision,
  type Flow,
  type FlowPane,
  type ReadRound,
} from "./judgment-panes.js";
import {
  checkNames,
  checkPlan,
  readPlan,
  type ReadRequest,
} from "./judgment-plan.js";
import { readSummary } from "./judgment-summary.js";
import type { BoundName } from "./tick-bounds.js";

/** What a judgment step did for an idea: the pane it started, the bound that held it, or nothing. */
export type JudgmentStep =
  | "spawn-judgment"
  | "retry-judgment"
  | "spawn-readers"
  | "plan-recorded"
  | "needs-info"
  | "held";

export interface JudgmentOutcome {
  step: JudgmentStep;
  pane?: string;
  bound?: BoundName;
}

/** Asks the host bounds whether one pane may start now; undefined when it may, and counts the start if so. */
export type Admit = () => Promise<BoundName | undefined>;

/** Every side effect a judgment step has: `session spawn`, `session close`, the pane's text, the PR and the label. */
export interface JudgmentPorts {
  spawn: (launch: Launch) => Promise<void>;
  close: (name: string) => Promise<void>;
  /** The finished pane's text, which carries its plan or its summary; read-only. */
  paneText: (name: string) => Promise<string>;
  /** The idea's pull request, read-only, so a brief can name it. */
  delivery: (issue: number) => Promise<Delivery>;
  /** Labels the issue `needs-info` with the reason, and says why in a comment. */
  needsInfo: (issue: number, reason: string) => Promise<void>;
  /** Persists a checked work plan for the idea; a rerun of the same plan persists nothing twice (ADR 0121). */
  persistPlan: (
    idea: string,
    issue: number,
    work: readonly WorkPiece[],
  ) => Promise<void>;
}

/** The idea a step works for, and the admission each pane start asks first. */
interface Ctx {
  idea: string;
  issue: number;
  admit: Admit;
}

/**
 * The tick's wiring to the judgment panes (ADR 0121). Each step acts before it closes the pane it
 * consumed, so a rerun after a crash finds that pane still open and does the step again.
 */
export class TickJudgment {
  constructor(private readonly ports: JudgmentPorts) {}

  /** Whether a judgment pane was ever started for the idea, so the flow decides or has ended. */
  begun(idea: string, panes: readonly FlowPane[]): boolean {
    return flowOf(idea, panes).decisions.length > 0;
  }

  /** Starts the flow's first judgment pane for an idea whose writer was sent back three times. */
  async begin(
    idea: string,
    issue: number,
    pr: number | undefined,
    sendBacks: number,
    admit: Admit,
  ): Promise<JudgmentOutcome> {
    const bound = await admit();
    if (bound !== undefined) {
      return { step: "held", bound };
    }
    const name = judgmentName(idea, 1);
    await this.ports.spawn({
      role: "judgment",
      name,
      issue,
      brief: judgmentBrief(idea, issue, pr, { kind: "start", sendBacks }),
    });
    return { step: "spawn-judgment", pane: name };
  }

  /** The next step for the flow's finished pane, or undefined when no pane of it waits for the tick. */
  async consume(
    idea: string,
    issue: number,
    panes: readonly FlowPane[],
    admit: Admit,
  ): Promise<JudgmentOutcome | undefined> {
    const flow = flowOf(idea, panes);
    const latest = flow.decisions.at(-1);
    if (latest === undefined) {
      return undefined;
    }
    const ctx: Ctx = { idea, issue, admit };
    if (isOpen(latest.pane)) {
      return isFinished(latest.pane) ? this.act(ctx, flow, latest) : undefined;
    }
    const round = flow.rounds.find((r) => r.ord === latest.ord);
    if (round === undefined || !round.readers.some(isOpen)) {
      return undefined;
    }
    return this.collect(ctx, flow, round);
  }

  /** Reads the decision's plan, checks it whole and does what the decision rules say. */
  private async act(
    ctx: Ctx,
    flow: Flow,
    latest: Decision,
  ): Promise<JudgmentOutcome | undefined> {
    const read = readPlan(await this.ports.paneText(latest.pane.name));
    const checked: PlanCheck = checkNames(
      ctx.idea,
      read.ok ? checkPlan(read.raw) : { ok: false, error: read.error },
    );
    // The round this pane itself made does not count against it when it decides again.
    const priorRounds = flow.rounds.filter((r) => r.ord < latest.ord).length;
    const next: Next = decide(
      { readRounds: priorRounds, refusals: flow.refusals },
      checked,
    );
    if (next.step === "read") {
      const have = flow.rounds.find((r) => r.ord === latest.ord)?.readers;
      return this.startReaders(
        ctx,
        latest,
        next.reads,
        new Set((have ?? []).map((r) => r.name)),
      );
    }
    if (next.step === "retry") {
      return this.retry(ctx, latest, next.reason);
    }
    if (next.step === "needs-info") {
      await this.ports.needsInfo(ctx.issue, next.reason);
      await this.ports.close(latest.pane.name);
      return { step: "needs-info" };
    }
    return this.work(ctx, latest, next.work);
  }

  /**
   * Persists a checked work plan, then closes the decision that made it. The plan is persisted before the
   * decision closes, so a crash leaves the decision open and a rerun persists the same plan again. The
   * tick starts the plan's pieces from the persisted plan, on the passes after this one (ADR 0121).
   */
  private async work(
    ctx: Ctx,
    latest: Decision,
    work: readonly WorkPiece[],
  ): Promise<JudgmentOutcome> {
    await this.ports.persistPlan(ctx.idea, ctx.issue, work);
    await this.ports.close(latest.pane.name);
    return { step: "plan-recorded" };
  }

  /** Starts one reader per question the round does not have yet, then closes the pane that asked. */
  private async startReaders(
    ctx: Ctx,
    latest: Decision,
    reads: readonly ReadRequest[],
    have: ReadonlySet<string>,
  ): Promise<JudgmentOutcome> {
    const bound = await ctx.admit();
    if (bound !== undefined) {
      return { step: "held", bound };
    }
    for (const [at, read] of reads.entries()) {
      const name = readerName(ctx.idea, latest.ord, at + 1);
      if (!have.has(name)) {
        await this.ports.spawn({
          role: "reader",
          name,
          issue: ctx.issue,
          brief: readerBrief(ctx.idea, ctx.issue, read),
        });
      }
    }
    await this.ports.close(latest.pane.name);
    return { step: "spawn-readers" };
  }

  /** Starts the one retry with the refusal as its reason, then closes the refused pane. */
  private async retry(
    ctx: Ctx,
    latest: Decision,
    reason: string,
  ): Promise<JudgmentOutcome> {
    const bound = await ctx.admit();
    if (bound !== undefined) {
      return { step: "held", bound };
    }
    const { pr } = await this.ports.delivery(ctx.issue);
    const name = retryName(ctx.idea, latest.ord + 1);
    await this.ports.spawn({
      role: "judgment",
      name,
      issue: ctx.issue,
      brief: judgmentBrief(ctx.idea, ctx.issue, pr, { kind: "retry", reason }),
    });
    await this.ports.close(latest.pane.name);
    return { step: "retry-judgment", pane: name };
  }

  /** Starts the fresh judgment pane with the round's summaries, then closes the readers. */
  private async collect(
    ctx: Ctx,
    flow: Flow,
    round: ReadRound,
  ): Promise<JudgmentOutcome | undefined> {
    const open = round.readers.filter(isOpen);
    if (!open.every(isFinished)) {
      return undefined;
    }
    const bound = await ctx.admit();
    if (bound !== undefined) {
      return { step: "held", bound };
    }
    const summaries: ReaderSummary[] = [];
    for (const reader of open) {
      summaries.push({
        name: reader.name,
        text: readSummary(await this.ports.paneText(reader.name)),
      });
    }
    const { pr } = await this.ports.delivery(ctx.issue);
    const name = judgmentName(ctx.idea, flow.nextOrd);
    await this.ports.spawn({
      role: "judgment",
      name,
      issue: ctx.issue,
      brief: judgmentBrief(ctx.idea, ctx.issue, pr, {
        kind: "after-reads",
        summaries,
      }),
    });
    for (const reader of open) {
      await this.ports.close(reader.name);
    }
    return { step: "spawn-judgment", pane: name };
  }
}

/** The extra fields a judgment step adds to its idea's step: the pane it started, or the bound that held it. */
export function judgedExtra(
  outcome: JudgmentOutcome,
): Partial<Pick<JudgmentOutcome, "pane" | "bound">> {
  return {
    ...(outcome.pane === undefined ? {} : { pane: outcome.pane }),
    ...(outcome.bound === undefined ? {} : { bound: outcome.bound }),
  };
}
