import { STAGES, type Stage } from "./stages.js";
import type { ToilKind } from "./toil.js";
import { widen, wipOf, type Wip } from "./wip.js";
import type { Span } from "./intervals.js";
import { clipMs } from "./scope.js";

/** Time an agent spent not advancing work, by kind; it overlaps active and waiting time. */
export interface Toil {
  /** Life start to the first tool call. */
  startingSeconds: number;
  /** The last tool call to close. */
  stoppingSeconds: number;
  /** Time a pane waited on a person. */
  waitingSeconds: number;
  /** A failed tool call's end to the next start of the same tool. */
  retryingSeconds: number;
}

export interface StageTotals {
  stage: Stage;
  activeSeconds: number;
  waitingSeconds: number;
  events: number;
  toil: Toil;
  wip: Wip;
}

interface StageMillis {
  activeMs: number;
  waitingMs: number;
  events: number;
  toilMs: Record<ToilKind, number>;
}

const emptyMillis = (): StageMillis => ({
  activeMs: 0,
  waitingMs: 0,
  events: 0,
  toilMs: { starting: 0, stopping: 0, waiting: 0, retrying: 0 },
});

/** Accumulates whole milliseconds per stage; seconds are derived once, at output. */
export class Tally {
  readonly totals = new Map<Stage, StageMillis>(
    STAGES.map((stage) => [stage, emptyMillis()]),
  );

  /** Only time inside this range is charged; infinite where an end is open. */
  constructor(readonly window: Span = [-Infinity, Infinity]) {}

  /** One open interval per idea per stage, from `present` calls between `beginIdea` and `endIdea`. */
  private readonly open = new Map<Stage, Span[]>(
    STAGES.map((stage) => [stage, []]),
  );
  private current = new Map<Stage, Span>();

  beginIdea() {
    this.current = new Map();
  }

  /** The idea was in `stage` from `from` to `to`; its open interval grows to hold it. */
  present(stage: Stage, from: number, to: number) {
    const clipped: Span = [
      Math.max(from, this.window[0]),
      Math.min(to, this.window[1]),
    ];
    if (clipped[1] >= clipped[0]) {
      this.current.set(stage, widen(this.current.get(stage), clipped));
    }
  }

  endIdea() {
    for (const [stage, span] of this.current) {
      (this.open.get(stage) as Span[]).push(span);
    }
  }

  /**
   * The report's range: the window where it has both ends, else the shortest
   * span holding every idea's open interval in every stage.
   */
  range(): Span {
    const all = [...this.open.values()].flat();
    const [lo, hi] = this.window;
    const held: Span =
      all.length === 0
        ? [0, 0]
        : [
            Math.min(...all.map(([from]) => from)),
            Math.max(...all.map(([, to]) => to)),
          ];
    return [
      Number.isFinite(lo) ? lo : held[0],
      Number.isFinite(hi) ? hi : held[1],
    ];
  }

  /** Charges milliseconds the caller already clipped to the window. */
  addMs(stage: Stage, field: "activeMs" | "waitingMs", ms: number) {
    (this.totals.get(stage) as StageMillis)[field] += ms;
  }

  /** Charges the part of `[from, to]` inside the window. */
  add(stage: Stage, field: "activeMs" | "waitingMs", from: number, to: number) {
    (this.totals.get(stage) as StageMillis)[field] += clipMs(
      this.window,
      from,
      to,
    );
  }

  /** Charges the part of `[from, to]` inside the window as toil. */
  addToil(stage: Stage, kind: ToilKind, from: number, to: number) {
    (this.totals.get(stage) as StageMillis).toilMs[kind] += clipMs(
      this.window,
      from,
      to,
    );
  }

  /** Charges toil already clipped by the caller. */
  addToilMs(stage: Stage, kind: ToilKind, ms: number) {
    (this.totals.get(stage) as StageMillis).toilMs[kind] += ms;
  }

  count(stage: Stage) {
    (this.totals.get(stage) as StageMillis).events += 1;
  }

  /** Stages in loop order, with milliseconds converted to seconds. */
  stages(): StageTotals[] {
    const range = this.range();
    return STAGES.map((stage) => {
      const { activeMs, waitingMs, events, toilMs } = this.totals.get(
        stage,
      ) as StageMillis;
      return {
        stage,
        activeSeconds: activeMs / 1000,
        waitingSeconds: waitingMs / 1000,
        events,
        toil: {
          startingSeconds: toilMs.starting / 1000,
          stoppingSeconds: toilMs.stopping / 1000,
          waitingSeconds: toilMs.waiting / 1000,
          retryingSeconds: toilMs.retrying / 1000,
        },
        wip: wipOf(this.open.get(stage) as Span[], range),
      };
    });
  }
}
