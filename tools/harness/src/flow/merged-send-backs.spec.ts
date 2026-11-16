import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow } from "./scope.js";
import {
  mergedChangeSendBacks,
  sendBacksPerMergedChange,
} from "./merged-send-backs.js";

vi.mock("./github-waits.js");
vi.mock("./scope.js");

const DAY = 86_400_000;
/** The report window is the eleventh day; the trailing day before it is the tenth. */
const WINDOW: [number, number] = [10 * DAY, 11 * DAY];
const ASOF = new Date(20 * DAY);
const OPTIONS = { trailingDays: 1, minMergedChanges: 1, asOf: ASOF };
const HEAD_A = "@abcdef1";
const HEAD_B = "@1234567";

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

/** A judge send-back of PR `number` at the PR head `head`. */
const sendBack = (ms: number, number: number, head: string) =>
  event(ms, "send-back", {
    number,
    label: `reason ${head}`,
    category: "rule-break",
  });

const merged = (ms: number, number: number) =>
  event(ms, "pr.merged", { number });

beforeEach(() => {
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockImplementation(
    ([start, end], t) => t >= start && t < end,
  );
});

describe("send-backs per merged change: the window's figure", () => {
  it("divides the send-backs in the window by the merged changes in it", () => {
    const r = sendBacksPerMergedChange(
      [
        sendBack(10.2 * DAY, 7, HEAD_A),
        sendBack(10.4 * DAY, 8, HEAD_B),
        merged(10.3 * DAY, 7),
        merged(10.6 * DAY, 8),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toEqual({
      status: "ok",
      sendBacks: 2,
      merged: 2,
      perMerged: 1,
    });
  });
});

describe("send-backs per merged change: which send-backs count", () => {
  it("counts a rerun at the same PR head once, so a repeated verdict is not a second send-back", () => {
    const r = sendBacksPerMergedChange(
      [
        sendBack(10.2 * DAY, 7, HEAD_A),
        sendBack(10.3 * DAY, 7, HEAD_A),
        merged(10.5 * DAY, 7),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toMatchObject({
      status: "ok",
      sendBacks: 1,
      perMerged: 1,
    });
  });

  it("counts a PR sent back again at a new head, since each head is its own change", () => {
    const r = sendBacksPerMergedChange(
      [
        sendBack(10.2 * DAY, 7, HEAD_A),
        sendBack(10.3 * DAY, 7, HEAD_B),
        merged(10.5 * DAY, 7),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toMatchObject({
      status: "ok",
      sendBacks: 2,
      perMerged: 2,
    });
  });
});

describe("send-backs per merged change: the window's edges and rounding", () => {
  it("leaves out send-backs at or after the window's end, and events that are not send-backs", () => {
    const r = sendBacksPerMergedChange(
      [
        sendBack(11 * DAY, 7, HEAD_A),
        event(10.2 * DAY, "pr.opened", { number: 9 }),
        merged(10.6 * DAY, 8),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toEqual({
      status: "ok",
      sendBacks: 0,
      merged: 1,
      perMerged: 0,
    });
  });

  it("reads zero send-backs as a real zero when merged changes were measured", () => {
    const r = sendBacksPerMergedChange(
      [merged(10.6 * DAY, 8)],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toEqual({
      status: "ok",
      sendBacks: 0,
      merged: 1,
      perMerged: 0,
    });
  });

  it("rounds the per-merged figure to four places", () => {
    const r = sendBacksPerMergedChange(
      [
        sendBack(10.2 * DAY, 7, HEAD_A),
        merged(10.1 * DAY, 1),
        merged(10.2 * DAY, 2),
        merged(10.3 * DAY, 3),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toMatchObject({ status: "ok", perMerged: 0.3333 });
  });
});

describe("send-backs per merged change: the minimum", () => {
  it("reports insufficient merged changes, and no value, below the minimum", () => {
    const r = sendBacksPerMergedChange(
      [sendBack(10.2 * DAY, 7, HEAD_A), merged(10.6 * DAY, 8)],
      WINDOW,
      { ...OPTIONS, minMergedChanges: 2 },
    );

    expect(r.current).toEqual({
      status: "insufficient merged changes",
      merged: 1,
      needed: 2,
    });
  });

  it("reports insufficient, never zero, when nothing merged in the window", () => {
    const r = sendBacksPerMergedChange(
      [sendBack(10.2 * DAY, 7, HEAD_A)],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toEqual({
      status: "insufficient merged changes",
      merged: 0,
      needed: 1,
    });
  });
});

describe("send-backs per merged change: the trailing average", () => {
  it("averages the same figure over the trailing days before the window, not the window itself", () => {
    const r = sendBacksPerMergedChange(
      [
        sendBack(9.2 * DAY, 3, HEAD_A),
        merged(9.5 * DAY, 3),
        sendBack(10.5 * DAY, 4, HEAD_B),
        sendBack(10.6 * DAY, 5, HEAD_A),
        merged(10.7 * DAY, 4),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.trailingAverage).toEqual({
      status: "ok",
      sendBacks: 1,
      merged: 1,
      perMerged: 1,
    });
  });

  it("reports the trailing average insufficient when no change merged in the trailing days", () => {
    const r = sendBacksPerMergedChange(
      [sendBack(9.5 * DAY, 3, HEAD_A), merged(10.6 * DAY, 8)],
      WINDOW,
      OPTIONS,
    );

    expect(r.trailingAverage).toEqual({
      status: "insufficient merged changes",
      merged: 0,
      needed: 1,
    });
  });

  it("ends the trailing days at as-of when the window has no start", () => {
    const r = sendBacksPerMergedChange(
      [sendBack(19.5 * DAY, 3, HEAD_A), merged(19.6 * DAY, 3)],
      [-Infinity, 20 * DAY],
      OPTIONS,
    );

    expect(r.trailingAverage).toMatchObject({ status: "ok", perMerged: 1 });
  });

  it("reports the trailing days and the minimum the figures were read against", () => {
    const r = sendBacksPerMergedChange([], WINDOW, {
      ...OPTIONS,
      trailingDays: 3,
      minMergedChanges: 4,
    });

    expect(r).toMatchObject({ trailingDays: 3, minMergedChanges: 4 });
  });
});

describe("mergedChangeSendBacks: the cost settings and the trailing days", () => {
  const ASOF_DAY = new Date(20 * DAY);

  it("reads the placeholder minimum and the default trailing days when the cost settings leave them out", () => {
    const r = mergedChangeSendBacks([], [-Infinity, 20 * DAY], {
      asOf: ASOF_DAY,
    });

    expect(r).toMatchObject({ trailingDays: 7, minMergedChanges: 5 });
  });

  it("reads the configured minimum merged changes, and keeps the default trailing days", () => {
    const r = mergedChangeSendBacks([], [-Infinity, 20 * DAY], {
      asOf: ASOF_DAY,
      cost: { minMergedChanges: 9, trailingIdeas: 3 },
    });

    expect(r).toMatchObject({ trailingDays: 7, minMergedChanges: 9 });
  });
});
