import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow } from "./scope.js";
import {
  leadTimePerMergedChange,
  mergedChangeLeadTime,
} from "./merged-lead-time.js";

vi.mock("./github-waits.js");
vi.mock("./scope.js");

const DAY = 86_400_000;
const SECOND = 1000;
/** The report window is the eleventh day; the trailing day before it is the tenth. */
const WINDOW: [number, number] = [10 * DAY, 11 * DAY];
const ASOF = new Date(20 * DAY);
const OPTIONS = { trailingDays: 1, minMergedChanges: 1, asOf: ASOF };

/** An event whose id is its time in milliseconds, so the mocked clock reads it back. */
function event(
  ms: number,
  kind: Kind,
  extra: Partial<LedgerEvent> = {},
): LedgerEvent {
  return {
    schema: 1,
    id: String(ms),
    source: "github",
    kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
    ...extra,
  } satisfies LedgerEvent;
}

const opened = (ms: number, number: number) =>
  event(ms, "pr.opened", { number });

const merged = (ms: number, number: number, extra: Partial<LedgerEvent> = {}) =>
  event(ms, "pr.merged", { number, ...extra });

beforeEach(() => {
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockImplementation(
    ([start, end], t) => t >= start && t < end,
  );
});

describe("lead time per merged change: the window's median", () => {
  it("measures each merged change from its pull request's opening event to its merge, and reports the median", () => {
    const r = leadTimePerMergedChange(
      [
        opened(10 * DAY, 1),
        merged(10 * DAY + 600 * SECOND, 1),
        opened(10 * DAY, 2),
        merged(10 * DAY + 1200 * SECOND, 2),
        opened(10 * DAY, 3),
        merged(10 * DAY + 3000 * SECOND, 3),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toEqual({
      status: "ok",
      merged: 3,
      measured: 3,
      medianSeconds: 1200,
    });
  });
});

describe("lead time per merged change: where the opening comes from", () => {
  it("takes the opening event from the ledger over the merge's own opened time", () => {
    const r = leadTimePerMergedChange(
      [
        opened(10 * DAY, 1),
        merged(10 * DAY + 600 * SECOND, 1, {
          openedAt: new Date(10 * DAY + 300 * SECOND).toISOString(),
        }),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toMatchObject({ status: "ok", medianSeconds: 600 });
  });

  it("falls back to the merge's own opened time when the ledger has no opening event", () => {
    const r = leadTimePerMergedChange(
      [
        merged(10 * DAY + 900 * SECOND, 4, {
          openedAt: new Date(10 * DAY).toISOString(),
        }),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toEqual({
      status: "ok",
      merged: 1,
      measured: 1,
      medianSeconds: 900,
    });
  });

  it("counts a merge with no opening time anywhere as merged but not measured", () => {
    const r = leadTimePerMergedChange(
      [
        merged(10 * DAY + 100 * SECOND, 5),
        opened(10 * DAY, 6),
        merged(10 * DAY + 400 * SECOND, 6),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toEqual({
      status: "ok",
      merged: 2,
      measured: 1,
      medianSeconds: 400,
    });
  });
});

describe("lead time per merged change: the median's rounding and window", () => {
  it("rounds the median to whole seconds", () => {
    const r = leadTimePerMergedChange(
      [
        opened(10 * DAY, 1),
        merged(10 * DAY + 600 * SECOND, 1),
        opened(10 * DAY, 2),
        merged(10 * DAY + 601 * SECOND, 2),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toMatchObject({ status: "ok", medianSeconds: 601 });
  });

  it("counts only merges inside the window, though their openings may come before it", () => {
    const r = leadTimePerMergedChange(
      [
        opened(9 * DAY, 1),
        merged(9.5 * DAY, 1),
        opened(10 * DAY, 2),
        merged(11 * DAY, 2),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toEqual({
      status: "insufficient merged changes",
      merged: 0,
      measured: 0,
      needed: 1,
    });
  });

  it("reports insufficient merged changes, with the measured count, below the minimum", () => {
    const r = leadTimePerMergedChange(
      [opened(10 * DAY, 1), merged(10 * DAY + 600 * SECOND, 1)],
      WINDOW,
      { ...OPTIONS, minMergedChanges: 2 },
    );

    expect(r.current).toEqual({
      status: "insufficient merged changes",
      merged: 1,
      measured: 1,
      needed: 2,
    });
  });

  it("reports insufficient, never zero, when no merge in the window has a measured opening", () => {
    const r = leadTimePerMergedChange(
      [merged(10 * DAY + 600 * SECOND, 1)],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toEqual({
      status: "insufficient merged changes",
      merged: 1,
      measured: 0,
      needed: 1,
    });
  });
});

describe("lead time per merged change: the trailing average", () => {
  it("averages the same median over the trailing days before the window, not the window itself", () => {
    const r = leadTimePerMergedChange(
      [
        opened(9 * DAY, 1),
        merged(9 * DAY + 500 * SECOND, 1),
        opened(10 * DAY, 2),
        merged(10.5 * DAY, 2),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.trailingAverage).toEqual({
      status: "ok",
      merged: 1,
      measured: 1,
      medianSeconds: 500,
    });
  });

  it("reports the trailing average insufficient when no change merged in the trailing days", () => {
    const r = leadTimePerMergedChange(
      [opened(10 * DAY, 2), merged(10.5 * DAY, 2)],
      WINDOW,
      OPTIONS,
    );

    expect(r.trailingAverage).toEqual({
      status: "insufficient merged changes",
      merged: 0,
      measured: 0,
      needed: 1,
    });
  });

  it("reports the trailing days and the minimum the figures were read against", () => {
    const r = leadTimePerMergedChange([], WINDOW, {
      ...OPTIONS,
      trailingDays: 3,
      minMergedChanges: 4,
    });

    expect(r).toMatchObject({ trailingDays: 3, minMergedChanges: 4 });
  });

  it("ends the trailing days at as-of when the window has no start", () => {
    const r = leadTimePerMergedChange(
      [opened(19.5 * DAY, 3), merged(19.5 * DAY + 250 * SECOND, 3)],
      [-Infinity, 20 * DAY],
      OPTIONS,
    );

    expect(r.trailingAverage).toMatchObject({
      status: "ok",
      medianSeconds: 250,
    });
  });
});

describe("mergedChangeLeadTime: the cost settings and the trailing days", () => {
  const ASOF_DAY = new Date(20 * DAY);

  it("reads the placeholder minimum and the default trailing days when the cost settings leave them out", () => {
    const r = mergedChangeLeadTime([], [-Infinity, 20 * DAY], {
      asOf: ASOF_DAY,
    });

    expect(r).toMatchObject({ trailingDays: 7, minMergedChanges: 5 });
  });

  it("reads the configured minimum merged changes, and keeps the default trailing days", () => {
    const r = mergedChangeLeadTime([], [-Infinity, 20 * DAY], {
      asOf: ASOF_DAY,
      cost: { minMergedChanges: 9, trailingIdeas: 3 },
    });

    expect(r).toMatchObject({ trailingDays: 7, minMergedChanges: 9 });
  });
});
