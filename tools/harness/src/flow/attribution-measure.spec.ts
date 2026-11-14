import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { T0, at } from "./flow-support.js";
import { COST_KINDS, measureAttribution } from "./attribution-measure.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

vi.mock("./github-waits.js");
vi.mock("./scope.js");

const WINDOW: Span = [T0, T0 + 10_000];
const hasStage = vi.fn<(event: LedgerEvent, own: LedgerEvent[]) => boolean>();

beforeEach(() => {
  vi.mocked(time).mockImplementation((e: LedgerEvent) =>
    Date.parse(e.occurredAt),
  );
  vi.mocked(inWindow).mockImplementation(
    (window: Span, when: number) => when >= window[0] && when < window[1],
  );
  hasStage.mockReturnValue(true);
});

describe("measureAttribution before any stamp", () => {
  it("reports nothing measured, and asks no stage, before any session carried a stamp", () => {
    const groups = [[at(5_000, "tool.end", { idea: "#1" })]];
    expect(measureAttribution(groups, [], WINDOW, undefined, hasStage)).toEqual(
      { since: null, events: 0, withIdea: 0, withIdeaAndStage: 0 },
    );
    expect(hasStage).not.toHaveBeenCalled();
  });

  it("starts measuring at the stamp, and says so as an ISO time", () => {
    const landed = Date.parse("2026-01-02T00:00:03Z");
    expect(measureAttribution([], [], WINDOW, landed, hasStage).since).toBe(
      "2026-01-02T00:00:03.000Z",
    );
  });
});

describe("measureAttribution counting", () => {
  it("counts an event with an idea, and one with an idea and a stage", () => {
    const first = at(5, "tool.end", { idea: "#1" });
    const second = at(6, "tool.end", { idea: "#1" });
    hasStage.mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(
      measureAttribution([[first, second]], [], WINDOW, T0, hasStage),
    ).toEqual({
      since: "2026-01-02T00:00:00.000Z",
      events: 2,
      withIdea: 2,
      withIdeaAndStage: 1,
    });
  });

  it("leaves out events from before the stamp, which cannot carry one", () => {
    const earlier = at(1, "tool.end", { idea: "#1" });
    const later = at(9, "tool.end", { idea: "#1" });
    expect(
      measureAttribution([[earlier, later]], [], WINDOW, time(later), hasStage),
    ).toMatchObject({ withIdea: 1 });
  });

  it("never counts cost events, which feed the cost metrics only", () => {
    const usage = at(5, "token.usage", { idea: "#1", tokens: 9 });
    const launch = at(6, "session.launch", { idea: "#1" });
    expect(COST_KINDS.has(usage.kind)).toBe(true);
    expect(
      measureAttribution([[usage, launch]], [], WINDOW, T0, hasStage),
    ).toMatchObject({ events: 0, withIdea: 0 });
    expect(hasStage).not.toHaveBeenCalled();
  });

  it("passes each counted event with the group it belongs to to the stage check", () => {
    const own = [at(5, "tool.end", { idea: "#2" })];
    measureAttribution([own], [], WINDOW, T0, hasStage);
    expect(hasStage).toHaveBeenCalledWith(own[0], own);
  });
});

describe("measureAttribution window and orphans", () => {
  it("leaves out events outside the window, checking each against it", () => {
    const outside = at(20, "tool.end", { idea: "#1" });
    expect(
      measureAttribution([[outside]], [], WINDOW, T0, hasStage),
    ).toMatchObject({ withIdea: 0 });
    expect(vi.mocked(inWindow)).toHaveBeenCalledWith(WINDOW, time(outside));
  });

  it("adds the counted orphans to the event count, but not to the idea count", () => {
    const orphan = at(4, "tool.end");
    const outsideOrphan = at(20, "tool.end");
    const costOrphan = at(3, "token.usage", { tokens: 1 });
    expect(
      measureAttribution(
        [],
        [orphan, outsideOrphan, costOrphan],
        WINDOW,
        T0,
        hasStage,
      ),
    ).toEqual({
      since: "2026-01-02T00:00:00.000Z",
      events: 1,
      withIdea: 0,
      withIdeaAndStage: 0,
    });
  });
});
