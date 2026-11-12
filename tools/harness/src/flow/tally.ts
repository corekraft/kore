import { STAGES, type Stage } from "./stages.js";
import type { ToilKind } from "./toil.js";

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

  add(stage: Stage, field: "activeMs" | "waitingMs", ms: number) {
    (this.totals.get(stage) as StageMillis)[field] += ms;
  }

  addToil(stage: Stage, kind: ToilKind, ms: number) {
    (this.totals.get(stage) as StageMillis).toilMs[kind] += ms;
  }

  count(stage: Stage) {
    (this.totals.get(stage) as StageMillis).events += 1;
  }

  /** Stages in loop order, with milliseconds converted to seconds. */
  stages(): StageTotals[] {
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
      };
    });
  }
}
