import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow } from "./scope.js";
import { ownerQuestions } from "./owner-questions.js";

vi.mock("./github-waits.js");
vi.mock("./scope.js");

const DAY = 86_400_000;
/** The report window is the eleventh day; the trailing day before it is the tenth. */
const WINDOW: [number, number] = [10 * DAY, 11 * DAY];
const ONE_DAY = 1;
const ASOF = new Date(20 * DAY);

/** An event whose id is its time in milliseconds, so the mocked clock reads it back. */
function event(ms: number, kind: Kind): LedgerEvent {
  return {
    schema: 1,
    id: String(ms),
    source: "claude",
    kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
  } satisfies LedgerEvent;
}

beforeEach(() => {
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockImplementation(
    ([start, end], t) => t >= start && t < end,
  );
});

describe("owner questions per merged change: the window's figure", () => {
  it("counts owner.asked events and merged pull requests in the window", () => {
    const r = ownerQuestions(
      [
        event(10.1 * DAY, "owner.asked"),
        event(10.2 * DAY, "owner.asked"),
        event(10.3 * DAY, "pr.merged"),
      ],
      WINDOW,
      { trailingDays: ONE_DAY, asOf: ASOF },
    );

    expect(r.questions).toBe(2);
    expect(r.merged).toBe(1);
    expect(r.perMerged).toBe(2);
  });

  it("counts no other kind, so an owner action is not a question", () => {
    const r = ownerQuestions(
      [event(10.1 * DAY, "owner.action"), event(10.2 * DAY, "pr.merged")],
      WINDOW,
      { trailingDays: ONE_DAY, asOf: ASOF },
    );

    expect(r.questions).toBe(0);
    expect(r.perMerged).toBe(0);
  });

  it("gives no per-merged figure when nothing merged in the window, yet still counts its questions", () => {
    const r = ownerQuestions([event(10.1 * DAY, "owner.asked")], WINDOW, {
      trailingDays: ONE_DAY,
      asOf: ASOF,
    });

    expect(r.questions).toBe(1);
    expect(r.merged).toBe(0);
    expect(r.perMerged).toBeNull();
  });

  it("rounds the per-merged figure to four places", () => {
    const r = ownerQuestions(
      [
        event(10.1 * DAY, "owner.asked"),
        event(10.2 * DAY, "pr.merged"),
        event(10.3 * DAY, "pr.merged"),
        event(10.4 * DAY, "pr.merged"),
      ],
      WINDOW,
      { trailingDays: ONE_DAY, asOf: ASOF },
    );

    expect(r.perMerged).toBe(0.3333);
  });

  it("leaves out events outside the window and outside the trailing days", () => {
    const r = ownerQuestions(
      [
        event(8.5 * DAY, "owner.asked"),
        event(11.5 * DAY, "owner.asked"),
        event(11.5 * DAY, "pr.merged"),
        event(10.5 * DAY, "pr.merged"),
      ],
      WINDOW,
      { trailingDays: ONE_DAY, asOf: ASOF },
    );

    expect(r.questions).toBe(0);
    expect(r.merged).toBe(1);
  });
});

describe("owner questions per merged change: the trailing average", () => {
  it("averages the same ratio over the trailing days before the window", () => {
    const r = ownerQuestions(
      [
        event(9.1 * DAY, "owner.asked"),
        event(9.2 * DAY, "owner.asked"),
        event(9.3 * DAY, "owner.asked"),
        event(9.4 * DAY, "pr.merged"),
        event(9.5 * DAY, "pr.merged"),
      ],
      WINDOW,
      { trailingDays: ONE_DAY, asOf: ASOF },
    );

    expect(r.trailingAverage).toBe(1.5);
  });

  it("is null when no change merged in the trailing days, so there is no average to compare", () => {
    const r = ownerQuestions(
      [event(9.1 * DAY, "owner.asked"), event(10.2 * DAY, "pr.merged")],
      WINDOW,
      { trailingDays: ONE_DAY, asOf: ASOF },
    );

    expect(r.trailingAverage).toBeNull();
    expect(r.worsened).toBe(false);
  });

  it("flags the window as worsened only when its figure is above the trailing average", () => {
    const above = ownerQuestions(
      [
        event(9.1 * DAY, "pr.merged"),
        event(10.1 * DAY, "owner.asked"),
        event(10.2 * DAY, "owner.asked"),
        event(10.3 * DAY, "pr.merged"),
      ],
      WINDOW,
      { trailingDays: ONE_DAY, asOf: ASOF },
    );
    const equal = ownerQuestions(
      [
        event(9.1 * DAY, "owner.asked"),
        event(9.2 * DAY, "pr.merged"),
        event(10.1 * DAY, "owner.asked"),
        event(10.2 * DAY, "pr.merged"),
      ],
      WINDOW,
      { trailingDays: ONE_DAY, asOf: ASOF },
    );

    expect(above.perMerged).toBe(2);
    expect(above.trailingAverage).toBe(0);
    expect(above.worsened).toBe(true);
    expect(equal.perMerged).toBe(1);
    expect(equal.trailingAverage).toBe(1);
    expect(equal.worsened).toBe(false);
  });

  it("takes the baseline from before as-of when the window has no start", () => {
    const r = ownerQuestions(
      [event(9.5 * DAY, "owner.asked"), event(9.6 * DAY, "pr.merged")],
      [Number.NEGATIVE_INFINITY, 11 * DAY],
      { trailingDays: ONE_DAY, asOf: new Date(10 * DAY) },
    );

    expect(r.trailingAverage).toBe(1);
  });

  it("names the trailing days it averaged over", () => {
    const r = ownerQuestions([], WINDOW, { trailingDays: 3, asOf: ASOF });

    expect(r.trailingDays).toBe(3);
  });
});
