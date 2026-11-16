import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import {
  mergedChangeStageTokens,
  tokensByStage,
  tokensByStagePerMergedChange,
} from "./merged-stage-tokens.js";
import { inWindow } from "./scope.js";
import { tokenStageResolver } from "./stage-of.js";
import { STAGES, type Stage } from "./stages.js";

vi.mock("./github-waits.js");
vi.mock("./scope.js");
vi.mock("./stage-of.js");

const DAY = 86_400_000;
/** The report window is the eleventh day; the trailing day before it is the tenth. */
const WINDOW: [number, number] = [10 * DAY, 11 * DAY];
const ASOF = new Date(20 * DAY);
const OPTIONS = { trailingDays: 1, minMergedChanges: 1, asOf: ASOF };

/** Every stage at zero, so a test names only the stages it spent in. */
const zeros = (): Record<Stage, number> =>
  Object.fromEntries(STAGES.map((stage) => [stage, 0])) as Record<
    Stage,
    number
  >;

/** An event whose id is its time in milliseconds, so the mocked clock reads it back. */
function event(
  ms: number,
  kind: Kind,
  extra: Partial<LedgerEvent> = {},
): LedgerEvent {
  return {
    schema: 1,
    id: String(ms),
    source: "claude",
    kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
    ...extra,
  } satisfies LedgerEvent;
}

/** A cumulative token.usage reading for one session, its agent naming the stage it spent in. */
const usage = (ms: number, agent: string, tokens: number) =>
  event(ms, "token.usage", { session: agent, agent, tokens });

beforeEach(() => {
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockImplementation(
    ([start, end], t) => t >= start && t < end,
  );
  // Stands in for the stage table: a reader spends in review, a writer in write, and any other agent in orchestrate.
  vi.mocked(tokenStageResolver).mockImplementation(() => (e) => {
    if (e.agent === "reader") {
      return "review";
    }
    return e.agent === "writer" ? "write" : "orchestrate";
  });
});

describe("tokens by stage: the window's spend, split by stage", () => {
  it("gives each stage the tokens its sessions spent in the window, with every stage present", () => {
    const r = tokensByStage(
      [
        usage(10.1 * DAY, "writer", 100),
        usage(10.5 * DAY, "writer", 300),
        usage(10.2 * DAY, "reader", 50),
        usage(10.4 * DAY, "lead", 40),
      ],
      WINDOW,
    );

    // The writer's count reads 300 at the window's end and nothing before it, so it spent 300.
    expect(r).toEqual({ ...zeros(), write: 300, review: 50, orchestrate: 40 });
  });

  it("counts only the tokens spent inside the window, not a session's total from before it", () => {
    const r = tokensByStage(
      [usage(9.5 * DAY, "writer", 1000), usage(10.5 * DAY, "writer", 1200)],
      WINDOW,
    );

    expect(r.write).toBe(200);
  });

  it("gives zero for every stage when no session spent in the window", () => {
    expect(tokensByStage([usage(9.5 * DAY, "writer", 1000)], WINDOW)).toEqual(
      zeros(),
    );
  });
});

describe("tokens by stage per merged change: the window and its trailing average", () => {
  it("divides each stage's tokens by the merged changes in the window, to four places", () => {
    const r = tokensByStagePerMergedChange(
      [
        usage(10.1 * DAY, "writer", 100),
        usage(10.5 * DAY, "writer", 200),
        event(10.3 * DAY, "pr.merged"),
        event(10.6 * DAY, "pr.merged"),
        event(10.7 * DAY, "pr.merged"),
      ],
      WINDOW,
      { ...OPTIONS, minMergedChanges: 3 },
    );

    expect(r.current).toEqual({
      status: "ok",
      merged: 3,
      perMerged: { ...zeros(), write: 66.6667 },
    });
  });

  it("reads no stage figure below the minimum merged changes, never a zero", () => {
    const r = tokensByStagePerMergedChange(
      [usage(10.1 * DAY, "writer", 100), event(10.3 * DAY, "pr.merged")],
      WINDOW,
      { ...OPTIONS, minMergedChanges: 2 },
    );

    expect(r.current).toEqual({
      status: "insufficient merged changes",
      merged: 1,
      needed: 2,
    });
  });

  it("gives the trailing average over the days before the window, not the window itself", () => {
    const r = tokensByStagePerMergedChange(
      [
        usage(9.1 * DAY, "writer", 100),
        event(9.3 * DAY, "pr.merged"),
        usage(10.1 * DAY, "writer", 900),
        event(10.3 * DAY, "pr.merged"),
      ],
      WINDOW,
      { ...OPTIONS, minMergedChanges: 1 },
    );

    expect(r.trailingAverage).toEqual({
      status: "ok",
      merged: 1,
      perMerged: { ...zeros(), write: 100 },
    });
    // The writer's count was 100 at the window's start, so it spent 800 inside it.
    expect(r.current).toMatchObject({ merged: 1, perMerged: { write: 800 } });
  });

  it("reads the cost settings' minimum and the seven-day trailing span when they are left out", () => {
    const r = mergedChangeStageTokens(
      [usage(10.1 * DAY, "writer", 100)],
      WINDOW,
      {
        asOf: ASOF,
      },
    );

    expect(r).toMatchObject({
      trailingDays: 7,
      minMergedChanges: 5,
      current: { status: "insufficient merged changes", merged: 0, needed: 5 },
    });
  });
});
