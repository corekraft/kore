import { vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { buildReport, type FlowReport } from "./report.js";
import { groupByIdea, select } from "./select.js";
import { STAGES, type Stage } from "./stages.js";
import type { Scope, Span } from "./scope.js";
import { Tally } from "./tally.js";
import type { Life, ToilKind } from "./toil.js";

export const WINDOW: Span = [0, 1000];
export const SCOPE: Scope = { since: null, until: null, ideas: null };
export const ASOF = new Date(1000);

type Millis = {
  activeMs: number;
  waitingMs: number;
  events: number;
  toilMs: Record<ToilKind, number>;
};
export type Covered = {
  own: LedgerEvent[];
  waits: [stage: Stage, start: number, stop: number][];
};

/** An event whose id is its time in milliseconds, which the mocked clock reads back. */
export function ev(ms: number, kind: Kind, fields: Partial<LedgerEvent> = {}) {
  const occurredAt = new Date(ms).toISOString();
  return {
    schema: 1,
    id: String(ms),
    source: "claude",
    kind,
    occurredAt,
    recordedAt: occurredAt,
    ...fields,
  } satisfies LedgerEvent;
}

/** An event of the writer pane `x-writer`, which the stage table maps to write. */
export const writer = (ms: number, kind: Kind) =>
  ev(ms, kind, { pane: "x-writer" });

export const run = (events: LedgerEvent[], minCompletedIdeas = 1): FlowReport =>
  buildReport(events, { asOf: ASOF, minCompletedIdeas });

/** The tally the constructor hands back, holding the waiting time given per stage. */
export function fakeTally(waiting: Partial<Record<Stage, number>> = {}) {
  const totals = new Map<Stage, Millis>(
    STAGES.map((stage): [Stage, Millis] => [
      stage,
      {
        activeMs: 0,
        waitingMs: waiting[stage] ?? 0,
        events: 0,
        toilMs: { starting: 0, stopping: 0, waiting: 0, retrying: 0 },
      },
    ]),
  );
  const calls = {
    count: vi.fn<Tally["count"]>(),
    present: vi.fn<Tally["present"]>(),
    add: vi.fn<Tally["add"]>(),
    addToil: vi.fn<Tally["addToil"]>(),
    addToilMs: vi.fn<Tally["addToilMs"]>(),
    stages: vi.fn<Tally["stages"]>(),
  };
  const tally = Object.assign(new Tally(WINDOW), { totals, ...calls });
  vi.mocked(Tally).mockImplementation(function () {
    return tally;
  });
  return calls;
}

export function fakeLife(): Life {
  return {
    began: false,
    lastToolAt: undefined,
    failed: undefined,
    waits: [],
    window: WINDOW,
  };
}

/** Covers every idea in `byIdea` as the select domain would: all of it, with no open waits. */
/** Covers one idea, `#1`, whose events are `own`. */
export function coverIdea(...own: LedgerEvent[]) {
  cover(new Map([["#1", own]]));
}

export function cover(
  byIdea: Map<string, LedgerEvent[]>,
  named: LedgerEvent[] = [],
  unattributed = 0,
) {
  vi.mocked(groupByIdea).mockReturnValue({
    byIdea,
    unattributed,
    orphans: [],
    named,
    landed: undefined,
  });
  const covered = new Map(
    [...byIdea].map(([idea, own]): [string, Covered] => [
      idea,
      { own, waits: [] },
    ]),
  );
  vi.mocked(select).mockReturnValue(covered);
}
