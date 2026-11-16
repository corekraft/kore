import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { COST_KINDS, measureAttribution } from "./attribution-measure.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

const T0 = Date.parse("2026-01-02T00:00:00.000Z");

let seq = 0;

/** A ledger event `seconds` after T0; the source is claude unless the fields name one. */
function at(
  seconds: number,
  kind: Kind,
  fields: Partial<LedgerEvent> = {},
): LedgerEvent {
  seq += 1;
  const occurredAt = new Date(T0 + seconds * 1000).toISOString();
  return {
    schema: 1,
    id: `e${seq}`,
    source: "claude",
    kind,
    occurredAt,
    recordedAt: occurredAt,
    ...fields,
  };
}

vi.mock("./github-waits.js");
vi.mock("./scope.js");

const WINDOW: Span = [T0, T0 + 10_000];
const hasStage = vi.fn<(event: LedgerEvent, own: LedgerEvent[]) => boolean>();
const hasRole = vi.fn<(event: LedgerEvent) => boolean>();
const checks = { hasStage, hasRole };

beforeEach(() => {
  vi.mocked(time).mockImplementation((e: LedgerEvent) =>
    Date.parse(e.occurredAt),
  );
  vi.mocked(inWindow).mockImplementation(
    (window: Span, when: number) => when >= window[0] && when < window[1],
  );
  hasStage.mockReset().mockReturnValue(true);
  hasRole.mockReset().mockReturnValue(true);
});

describe("measureAttribution before any stamp", () => {
  it("reports nothing measured, and asks no stage or role, before any session carried a stamp", () => {
    const groups = [[at(5_000, "tool.end", { idea: "#1" })]];
    expect(measureAttribution(groups, [], WINDOW, undefined, checks)).toEqual({
      since: null,
      events: 0,
      withIdea: 0,
      withIdeaAndStage: 0,
      noRoleShare: null,
    });
    expect(hasStage).not.toHaveBeenCalled();
    expect(hasRole).not.toHaveBeenCalled();
  });

  it("starts measuring at the stamp, and says so as an ISO time", () => {
    const landed = Date.parse("2026-01-02T00:00:03Z");
    expect(measureAttribution([], [], WINDOW, landed, checks).since).toBe(
      "2026-01-02T00:00:03.000Z",
    );
  });
});

describe("measureAttribution counting", () => {
  it("counts a role event with an idea, and one with an idea and a stage", () => {
    const first = at(5, "tool.end", { idea: "#1" });
    const second = at(6, "tool.end", { idea: "#1" });
    hasStage.mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(
      measureAttribution([[first, second]], [], WINDOW, T0, checks),
    ).toEqual({
      since: "2026-01-02T00:00:00.000Z",
      events: 2,
      withIdea: 2,
      withIdeaAndStage: 1,
      noRoleShare: 0,
    });
  });

  it("leaves out events from before the stamp, which cannot carry one", () => {
    const earlier = at(1, "tool.end", { idea: "#1" });
    const later = at(9, "tool.end", { idea: "#1" });
    expect(
      measureAttribution([[earlier, later]], [], WINDOW, time(later), checks),
    ).toMatchObject({ withIdea: 1 });
  });

  it("never counts cost events, which feed the cost metrics only", () => {
    const usage = at(5, "token.usage", { idea: "#1", tokens: 9 });
    const launch = at(6, "session.launch", { idea: "#1" });
    expect(COST_KINDS.has(usage.kind)).toBe(true);
    expect(
      measureAttribution([[usage, launch]], [], WINDOW, T0, checks),
    ).toMatchObject({ events: 0, withIdea: 0, noRoleShare: null });
    expect(hasStage).not.toHaveBeenCalled();
    expect(hasRole).not.toHaveBeenCalled();
  });

  it("passes each counted role event with the group it belongs to to the stage check", () => {
    const own = [at(5, "tool.end", { idea: "#2" })];
    measureAttribution([own], [], WINDOW, T0, checks);
    expect(hasStage).toHaveBeenCalledWith(own[0], own);
  });
});

describe("measureAttribution counts role sessions only", () => {
  it("leaves a session with no role out of attribution, and never asks it a stage", () => {
    const roleEvent = at(5, "tool.end", { idea: "#1", agent: "x-writer" });
    const mainEvent = at(6, "tool.end", { idea: "#1" });
    hasRole.mockImplementation((e) => e === roleEvent);
    expect(
      measureAttribution([[roleEvent, mainEvent]], [], WINDOW, T0, checks),
    ).toEqual({
      since: "2026-01-02T00:00:00.000Z",
      events: 1,
      withIdea: 1,
      withIdeaAndStage: 1,
      noRoleShare: 0.5,
    });
    expect(hasStage).toHaveBeenCalledTimes(1);
    expect(hasStage).not.toHaveBeenCalledWith(mainEvent, expect.anything());
  });

  it("leaves GitHub events out of attribution and out of the no-role share, as they come from no session", () => {
    const github = at(5, "pr.opened", { source: "github", idea: "#1" });
    const roleEvent = at(6, "tool.end", { idea: "#1" });
    expect(
      measureAttribution(
        [[github, roleEvent]],
        [at(7, "pr.merged", { source: "github" })],
        WINDOW,
        T0,
        checks,
      ),
    ).toEqual({
      since: "2026-01-02T00:00:00.000Z",
      events: 1,
      withIdea: 1,
      withIdeaAndStage: 1,
      noRoleShare: 0,
    });
    expect(hasRole).not.toHaveBeenCalledWith(github);
  });
});

describe("measureAttribution reports the no-role share", () => {
  it("reports the share of session events from sessions with no role, to four places", () => {
    const roles = [
      at(1, "tool.end", { idea: "#1" }),
      at(2, "tool.end", { idea: "#1" }),
    ];
    const main = at(3, "tool.end", { idea: "#1" });
    hasRole.mockImplementation((e) => e !== main);
    expect(
      measureAttribution([[...roles, main]], [], WINDOW, T0, checks)
        .noRoleShare,
    ).toBe(0.3333);
  });

  it("counts a role orphan in events and a no-role orphan only in the share", () => {
    const roleOrphan = at(4, "tool.end", { agent: "x-judge" });
    const mainOrphan = at(5, "tool.end");
    hasRole.mockImplementation((e) => e === roleOrphan);
    expect(
      measureAttribution([], [roleOrphan, mainOrphan], WINDOW, T0, checks),
    ).toEqual({
      since: "2026-01-02T00:00:00.000Z",
      events: 1,
      withIdea: 0,
      withIdeaAndStage: 0,
      noRoleShare: 0.5,
    });
  });

  it("reports no share while no session event is in range, never zero", () => {
    expect(
      measureAttribution(
        [[at(20, "tool.end", { idea: "#1" })]],
        [],
        WINDOW,
        T0,
        checks,
      ).noRoleShare,
    ).toBeNull();
  });
});

describe("measureAttribution window and orphans", () => {
  it("leaves out events outside the window, checking each against it", () => {
    const outside = at(20, "tool.end", { idea: "#1" });
    expect(
      measureAttribution([[outside]], [], WINDOW, T0, checks),
    ).toMatchObject({ withIdea: 0 });
    expect(vi.mocked(inWindow)).toHaveBeenCalledWith(WINDOW, time(outside));
  });

  it("adds the counted role orphans to the event count, but not to the idea count", () => {
    const orphan = at(4, "tool.end");
    const outsideOrphan = at(20, "tool.end");
    const costOrphan = at(3, "token.usage", { tokens: 1 });
    expect(
      measureAttribution(
        [],
        [orphan, outsideOrphan, costOrphan],
        WINDOW,
        T0,
        checks,
      ),
    ).toEqual({
      since: "2026-01-02T00:00:00.000Z",
      events: 1,
      withIdea: 0,
      withIdeaAndStage: 0,
      noRoleShare: 0,
    });
  });
});
