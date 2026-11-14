import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow } from "./scope.js";
import { median } from "./wip.js";
import {
  DEFAULT_HOST_DAYS,
  MIN_BASELINE_SAMPLES,
  hostPressure,
} from "./host-pressure.js";

vi.mock("./github-waits.js");
vi.mock("./scope.js");
vi.mock("./wip.js");

const DAY = 86_400_000;
const GIB = 1024 ** 3;
const ASOF = new Date(10 * DAY);
const WINDOW: [number, number] = [5 * DAY, 10 * DAY];

/** A host sample whose id is its time in milliseconds, so the mocked clock reads it back. */
function sample(ms: number, fields: Partial<LedgerEvent> = {}): LedgerEvent {
  return {
    schema: 1,
    id: String(ms),
    source: "herdr",
    kind: "host-sample",
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
    sessions: 1,
    platform: false,
    ...fields,
  };
}

const run = (events: LedgerEvent[], window = WINDOW, days = 5) =>
  hostPressure(events, window, { trailingDays: days, asOf: ASOF });

beforeEach(() => {
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockImplementation(
    ([from, to], at) => at >= from && at < to,
  );
  vi.mocked(median).mockImplementation((values) => {
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    if (s.length === 0) {
      return null;
    }
    return s.length % 2 === 1
      ? (s[mid] as number)
      : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
  });
});

describe("hostPressure by session count", () => {
  it("is the median and peak swap and load of the samples at each live-session count", () => {
    const r = run([
      sample(6 * DAY, { sessions: 1, swap: 1 * GIB, load: 2 }),
      sample(7 * DAY, { sessions: 1, swap: 3 * GIB, load: 4 }),
      sample(8 * DAY, { sessions: 1, swap: 8 * GIB, load: 3 }),
      sample(9 * DAY, { sessions: 3, swap: 6 * GIB, load: 9 }),
    ]);
    expect(r.samples).toBe(4);
    expect(r.levels.map((l) => [l.sessions, l.samples])).toEqual([
      [1, 3],
      [3, 1],
    ]);
    expect(r.levels[0]?.swap).toMatchObject({ median: 3 * GIB, peak: 8 * GIB });
    expect(r.levels[0]?.load).toMatchObject({ median: 3, peak: 4 });
    expect(r.levels[1]?.swap).toMatchObject({ median: 6 * GIB, peak: 6 * GIB });
  });

  it("leaves a reading out of its median and peak when the host gave none, rather than counting a zero", () => {
    const r = run([
      sample(6 * DAY, { swap: 2 * GIB, load: 1 }),
      sample(7 * DAY, { load: 3 }),
    ]);
    expect(r.levels[0]?.samples).toBe(2);
    expect(r.levels[0]?.swap).toMatchObject({ median: 2 * GIB, peak: 2 * GIB });
    expect(r.levels[0]?.load).toMatchObject({ median: 2, peak: 3 });
  });

  it("reports a null median and peak when no sample at a level read that field", () => {
    const r = run([sample(6 * DAY, { load: 1 })]);
    expect(r.levels[0]?.swap).toMatchObject({ median: null, peak: null });
  });

  it("orders levels by session count, then loop-only before platform-up", () => {
    const r = run([
      sample(6 * DAY, { sessions: 3, platform: false }),
      sample(6 * DAY + 1, { sessions: 1, platform: true }),
      sample(6 * DAY + 2, { sessions: 1, platform: false }),
    ]);
    expect(r.levels.map((l) => [l.sessions, l.platform])).toEqual([
      [1, false],
      [1, true],
      [3, false],
    ]);
  });
});

describe("hostPressure platform split", () => {
  it("keeps samples taken with the platform up apart from loop-only samples at the same count", () => {
    const r = run([
      sample(6 * DAY, { sessions: 2, platform: false, swap: 1 * GIB }),
      sample(7 * DAY, { sessions: 2, platform: true, swap: 7 * GIB }),
    ]);
    expect(r.levels).toHaveLength(2);
    expect(r.levels[0]).toMatchObject({ platform: false, samples: 1 });
    expect(r.levels[0]?.swap.peak).toBe(1 * GIB);
    expect(r.levels[1]).toMatchObject({ platform: true, samples: 1 });
    expect(r.levels[1]?.swap.peak).toBe(7 * GIB);
  });
});

describe("hostPressure baseline", () => {
  const baseline = (swaps: number[]) =>
    swaps.map((swap, i) => sample(2 * DAY + i, { swap, load: 1 }));

  it("is the median and population spread of the trailing days before the window, per level", () => {
    const r = run(
      [
        ...baseline([2, 4, 6]),
        // Outside the three trailing days before the window: not in the baseline.
        sample(DAY, { swap: 900, load: 1 }),
        sample(6 * DAY, { swap: 3, load: 1 }),
      ],
      WINDOW,
      3,
    );
    expect(r.levels[0]?.swap.baseline).toEqual({
      status: "ok",
      samples: 3,
      median: 4,
      spread: Math.sqrt(8 / 3),
      worsened: false,
    });
  });
});

describe("hostPressure worse than baseline", () => {
  const baseline = (swaps: number[]) =>
    swaps.map((swap, i) => sample(2 * DAY + i, { swap, load: 1 }));

  it("flags a median above the baseline median by more than the spread", () => {
    const r = run([
      ...baseline([2, 4, 6]),
      sample(6 * DAY, { swap: 9, load: 1 }),
    ]);
    expect(r.levels[0]?.swap.baseline).toMatchObject({ worsened: true });
    expect(r.levels[0]?.load.baseline).toMatchObject({ worsened: false });
  });

  it("does not flag a median above the baseline by no more than the spread", () => {
    const r = run([
      ...baseline([2, 4, 6]),
      sample(6 * DAY, { swap: 5, load: 1 }),
    ]);
    expect(r.levels[0]?.swap.baseline).toMatchObject({ worsened: false });
  });

  it("says insufficient history when fewer than the needed baseline samples exist", () => {
    const r = run([
      ...baseline([2, 4]),
      sample(6 * DAY, { swap: 99, load: 1 }),
    ]);
    expect(r.levels[0]?.swap.baseline).toEqual({
      status: "insufficient history",
      samples: 2,
      needed: MIN_BASELINE_SAMPLES,
    });
  });

  it("compares only baseline samples of the same level", () => {
    const r = run([
      ...baseline([2, 4, 6]),
      sample(6 * DAY, { sessions: 3, swap: 99, load: 1 }),
    ]);
    expect(r.levels[0]?.swap.baseline).toMatchObject({
      status: "insufficient history",
      samples: 0,
    });
  });

  it("ends the baseline at as-of when the report has no start", () => {
    const r = run(
      [
        ...[2, 4, 6].map((swap, i) => sample(7 * DAY + i, { swap, load: 1 })),
        sample(9 * DAY, { swap: 50, load: 1 }),
      ],
      [-Infinity, Infinity],
    );
    // The baseline covers the five days before as-of, so it holds every sample here.
    expect(r.levels[0]?.swap.baseline).toMatchObject({ samples: 4 });
  });

  it("defaults to several trailing days", () => {
    expect(DEFAULT_HOST_DAYS).toBe(7);
    expect(MIN_BASELINE_SAMPLES).toBe(3);
  });
});

describe("hostPressure empty window", () => {
  it("has no samples and no levels, not zeros, when none fall in the window", () => {
    const r = run([sample(DAY, { swap: 5 })]);
    expect(r).toEqual({ trailingDays: 5, samples: 0, levels: [] });
  });

  it("ignores events of other kinds", () => {
    const r = run([{ ...sample(6 * DAY), kind: "session.start" }]);
    expect(r.samples).toBe(0);
  });

  it("states the trailing days it was given in its JSON shape", () => {
    const r = run(
      [sample(6 * DAY, { sessions: 2, platform: true, swap: 5, load: 1 })],
      WINDOW,
      3,
    );
    expect(r).toEqual({
      trailingDays: 3,
      samples: 1,
      levels: [
        {
          sessions: 2,
          platform: true,
          samples: 1,
          swap: {
            median: 5,
            peak: 5,
            baseline: { status: "insufficient history", samples: 0, needed: 3 },
          },
          load: {
            median: 1,
            peak: 1,
            baseline: { status: "insufficient history", samples: 0, needed: 3 },
          },
        },
      ],
    });
  });
});
