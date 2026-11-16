import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow } from "./scope.js";
import { mergedChangeTokens, tokensPerMergedChange } from "./merged-tokens.js";

vi.mock("./github-waits.js");
vi.mock("./scope.js");

const DAY = 86_400_000;
/** The report window is the eleventh day; the trailing day before it is the tenth. */
const WINDOW: [number, number] = [10 * DAY, 11 * DAY];
const ONE_DAY = 1;
const ASOF = new Date(20 * DAY);
const OPTIONS = { trailingDays: ONE_DAY, minMergedChanges: 1, asOf: ASOF };

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

/** A cumulative token.usage reading for one session. */
const usage = (ms: number, session: string, tokens: number) =>
  event(ms, "token.usage", { session, tokens });

beforeEach(() => {
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockImplementation(
    ([start, end], t) => t >= start && t < end,
  );
});

describe("tokens per merged change: the window's figure", () => {
  it("divides the tokens spent in the window by the merged changes in it", () => {
    const r = tokensPerMergedChange(
      [
        usage(10.1 * DAY, "a", 100),
        usage(10.5 * DAY, "a", 300),
        usage(10.2 * DAY, "b", 50),
        event(10.3 * DAY, "pr.merged"),
        event(10.6 * DAY, "pr.merged"),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toEqual({
      status: "ok",
      tokens: 350,
      merged: 2,
      perMerged: 175,
    });
  });

  it("counts only the tokens spent inside the window, not a session's total from before it", () => {
    const r = tokensPerMergedChange(
      [
        usage(9.5 * DAY, "a", 1000),
        usage(10.5 * DAY, "a", 1200),
        event(10.6 * DAY, "pr.merged"),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toMatchObject({
      status: "ok",
      tokens: 200,
      perMerged: 200,
    });
  });

  it("counts a session with no reading inside the window as spending nothing there", () => {
    const r = tokensPerMergedChange(
      [
        usage(9.5 * DAY, "a", 1000),
        usage(10.5 * DAY, "b", 40),
        event(10.6 * DAY, "pr.merged"),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toMatchObject({ status: "ok", tokens: 40 });
  });

  it("leaves out readings and merges at or after the window's end, since the end is exclusive", () => {
    const r = tokensPerMergedChange(
      [
        usage(10.5 * DAY, "a", 100),
        usage(11 * DAY, "a", 999),
        event(10.6 * DAY, "pr.merged"),
        event(11 * DAY, "pr.merged"),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toEqual({
      status: "ok",
      tokens: 100,
      merged: 1,
      perMerged: 100,
    });
  });
});

describe("tokens per merged change: rounding and the minimum", () => {
  it("skips a token.usage event that carries no count, so it is not a zero reading", () => {
    const r = tokensPerMergedChange(
      [
        event(10.2 * DAY, "token.usage", { session: "a" }),
        usage(10.5 * DAY, "b", 70),
        event(10.6 * DAY, "pr.merged"),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toMatchObject({ status: "ok", tokens: 70 });
  });

  it("rounds the per-merged figure to four places", () => {
    const r = tokensPerMergedChange(
      [
        usage(10.5 * DAY, "a", 1),
        event(10.1 * DAY, "pr.merged"),
        event(10.2 * DAY, "pr.merged"),
        event(10.3 * DAY, "pr.merged"),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.current).toMatchObject({ status: "ok", perMerged: 0.3333 });
  });

  it("reports insufficient merged changes, and no value, when the window has fewer than the minimum", () => {
    const r = tokensPerMergedChange(
      [usage(10.5 * DAY, "a", 500), event(10.6 * DAY, "pr.merged")],
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
    const r = tokensPerMergedChange(
      [usage(10.5 * DAY, "a", 500)],
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

describe("tokens per merged change: the trailing average", () => {
  it("averages the same figure over the trailing days before the window, not the window itself", () => {
    const r = tokensPerMergedChange(
      [
        usage(9.2 * DAY, "a", 400),
        event(9.5 * DAY, "pr.merged"),
        usage(10.5 * DAY, "b", 9000),
        event(10.6 * DAY, "pr.merged"),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.trailingAverage).toEqual({
      status: "ok",
      tokens: 400,
      merged: 1,
      perMerged: 400,
    });
  });

  it("reads the trailing days from the tokens before them, so their own spend is not carried in", () => {
    const r = tokensPerMergedChange(
      [
        usage(8.5 * DAY, "a", 1000),
        usage(9.5 * DAY, "a", 1600),
        event(9.6 * DAY, "pr.merged"),
      ],
      WINDOW,
      OPTIONS,
    );

    expect(r.trailingAverage).toMatchObject({ status: "ok", tokens: 600 });
  });

  it("reports the trailing average insufficient when no change merged in the trailing days", () => {
    const r = tokensPerMergedChange(
      [usage(9.5 * DAY, "a", 400), event(10.6 * DAY, "pr.merged")],
      WINDOW,
      OPTIONS,
    );

    expect(r.trailingAverage).toEqual({
      status: "insufficient merged changes",
      merged: 0,
      needed: 1,
    });
  });

  it("reports the trailing days and the minimum the figures were read against", () => {
    const r = tokensPerMergedChange([], WINDOW, {
      ...OPTIONS,
      trailingDays: 3,
      minMergedChanges: 4,
    });

    expect(r).toMatchObject({ trailingDays: 3, minMergedChanges: 4 });
  });

  it("ends the trailing days at as-of when the window has no start", () => {
    const r = tokensPerMergedChange(
      [usage(19.5 * DAY, "a", 250), event(19.6 * DAY, "pr.merged")],
      [-Infinity, 20 * DAY],
      OPTIONS,
    );

    expect(r.trailingAverage).toMatchObject({ status: "ok", perMerged: 250 });
  });
});

describe("mergedChangeTokens: the cost settings and the trailing days", () => {
  const ASOF_DAY = new Date(20 * DAY);

  it("reads the placeholder minimum and the default trailing days when the cost settings leave them out", () => {
    const r = mergedChangeTokens([], [-Infinity, 20 * DAY], { asOf: ASOF_DAY });

    expect(r).toMatchObject({ trailingDays: 7, minMergedChanges: 5 });
  });

  it("reads the configured minimum merged changes, and keeps the default trailing days", () => {
    const r = mergedChangeTokens([], [-Infinity, 20 * DAY], {
      asOf: ASOF_DAY,
      cost: { minMergedChanges: 9, trailingIdeas: 3 },
    });

    expect(r).toMatchObject({ trailingDays: 7, minMergedChanges: 9 });
  });

  it("reads the window's merged changes against the configured minimum", () => {
    const r = mergedChangeTokens(
      [usage(19.5 * DAY, "a", 250), event(19.6 * DAY, "pr.merged")],
      [-Infinity, 20 * DAY],
      { asOf: ASOF_DAY, cost: { minMergedChanges: 2 } },
    );

    expect(r.current).toEqual({
      status: "insufficient merged changes",
      merged: 1,
      needed: 2,
    });
  });
});
