import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { advisorQuality, REFUTING_SHARE } from "./advisor-quality.js";
import { time } from "./github-waits.js";
import { inWindow } from "./scope.js";

// Factories, not automocks: an automock loads the real module, which the budget charges to each test.
vi.mock("./github-waits.js", () => ({ time: vi.fn() }));
vi.mock("./scope.js", () => ({ inWindow: vi.fn() }));

/** The window is [10, 1000) in milliseconds: it starts at 10 and ends before 1000. */
const WINDOW: [number, number] = [10, 1000];

/** An event whose id is its time in milliseconds, so the mocked clock reads it back. */
function event(ms: number, kind: Kind): LedgerEvent {
  return {
    schema: 1,
    id: String(ms),
    source: "claude",
    kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
  };
}

/** `count` events of `kind` at times from `from`, one millisecond apart. */
const many = (from: number, count: number, kind: Kind) =>
  Array.from({ length: count }, (_, i) => event(from + i, kind));

beforeEach(() => {
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockImplementation(
    (span, at) => at >= span[0] && at < span[1],
  );
});

describe("advisorQuality: the overturn figure (ADR 0120)", () => {
  it("counts the decisions made and overturned inside the window, and no others", () => {
    const events = [
      event(5, "decision.made"),
      event(12, "decision.made"),
      event(15, "advisor.overturned"),
      event(1000, "advisor.overturned"),
    ];

    const quality = advisorQuality(events, WINDOW);

    expect(quality).toMatchObject({ made: 1, overturned: 1 });
  });

  it("gives overturned over made, to four places", () => {
    const events = [
      ...many(10, 3, "decision.made"),
      event(15, "advisor.overturned"),
    ];

    expect(advisorQuality(events, WINDOW).perMade).toBe(0.3333);
  });

  it("is null, never zero, when no decision was made in the window", () => {
    expect(advisorQuality([], WINDOW).perMade).toBeNull();
  });

  it("refutes the advisor only above the refuting share, not at it", () => {
    const atShare = [
      ...many(10, 100, "decision.made"),
      ...many(10, 7, "advisor.overturned"),
    ];
    const above = [
      ...many(10, 100, "decision.made"),
      ...many(10, 8, "advisor.overturned"),
    ];

    expect(advisorQuality(atShare, WINDOW).refuted).toBe(false);
    expect(advisorQuality(above, WINDOW).refuted).toBe(true);
  });

  it("names the refuting share it was judged against, so the figure says its own line", () => {
    expect(advisorQuality([], WINDOW)).toMatchObject({
      refutingShare: REFUTING_SHARE,
      refuted: false,
    });
    expect(REFUTING_SHARE).toBe(0.07);
  });
});
