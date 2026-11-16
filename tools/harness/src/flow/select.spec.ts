import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { stampLanded, withPaneAgents } from "./agents.js";
import { attribute } from "./attribution.js";
import { githubSpans, time, type GithubWait } from "./github-waits.js";
import { inWindow, type Scope } from "./scope.js";
import { groupByIdea, reach, select } from "./select.js";

vi.mock("./agents.js");
vi.mock("./attribution.js");
vi.mock("./github-waits.js");
vi.mock("./scope.js");

/** An event whose id is its time in milliseconds, so the mocked clock reads it back. */
function event(ms: number, kind: Kind = "tool.start"): LedgerEvent {
  return {
    schema: 1,
    id: String(ms),
    source: "claude",
    kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
  };
}

const ALL_IDEAS: Scope = { since: null, until: null, ideas: null };

beforeEach(() => {
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockReturnValue(true);
  vi.mocked(githubSpans).mockReturnValue([]);
});

describe("groupByIdea", () => {
  it("groups each attributed event under its idea", () => {
    const [a, b, c] = [event(1), event(2), event(3)];
    vi.mocked(withPaneAgents).mockReturnValue([a, b, c]);
    vi.mocked(attribute).mockReturnValue(
      new Map([
        ["1", "#1"],
        ["2", undefined],
        ["3", "#2"],
      ]),
    );
    const { byIdea } = groupByIdea([a, b, c], [0, 100]);
    expect(byIdea).toEqual(
      new Map([
        ["#1", [a]],
        ["#2", [c]],
      ]),
    );
  });

  it("leaves repository events out of attribution, though they stay in the named events", () => {
    const work = event(1);
    const ci = event(2, "ci.main");
    vi.mocked(withPaneAgents).mockReturnValue([work, ci]);
    vi.mocked(attribute).mockReturnValue(new Map([["1", "#1"]]));
    const { named } = groupByIdea([work, ci], [0, 100]);
    expect(attribute).toHaveBeenCalledWith([work]);
    expect(named).toEqual([work, ci]);
  });

  it("leaves an unstamped spawn out of attribution, since it is a session's record and no work", () => {
    const work = event(1);
    const spawned = event(2, "spawn.unstamped");
    vi.mocked(withPaneAgents).mockReturnValue([work, spawned]);
    vi.mocked(attribute).mockReturnValue(new Map([["1", "#1"]]));
    const { byIdea, orphans, unattributed, named } = groupByIdea(
      [work, spawned],
      [0, 100],
    );
    expect(attribute).toHaveBeenCalledWith([work]);
    expect(byIdea).toEqual(new Map([["#1", [work]]]));
    expect(orphans).toEqual([]);
    expect(unattributed).toBe(0);
    expect(named).toEqual([work, spawned]);
  });

  it("counts an unattributed event inside the window, and keeps it as an orphan", () => {
    const loose = event(7);
    vi.mocked(withPaneAgents).mockReturnValue([loose]);
    vi.mocked(attribute).mockReturnValue(new Map([["7", undefined]]));
    const { unattributed, orphans } = groupByIdea([loose], [0, 100]);
    expect(inWindow).toHaveBeenCalledWith([0, 100], 7);
    expect(unattributed).toBe(1);
    expect(orphans).toEqual([loose]);
  });

  it("does not count an unattributed event outside the window", () => {
    const loose = event(700);
    vi.mocked(withPaneAgents).mockReturnValue([loose]);
    vi.mocked(attribute).mockReturnValue(new Map([["700", undefined]]));
    vi.mocked(inWindow).mockReturnValue(false);
    const { unattributed, orphans } = groupByIdea([loose], [0, 100]);
    expect(unattributed).toBe(0);
    expect(orphans).toEqual([]);
  });

  it("returns the landed stamp read from the events before naming", () => {
    const work = event(1);
    vi.mocked(withPaneAgents).mockReturnValue([work]);
    vi.mocked(attribute).mockReturnValue(new Map());
    vi.mocked(stampLanded).mockReturnValue(42);
    expect(groupByIdea([work], [0, 100]).landed).toBe(42);
    expect(stampLanded).toHaveBeenCalledWith([work]);
  });
});

describe("reach", () => {
  it("is the latest of an idea's events and the end of its latest open wait", () => {
    const wait: GithubWait = ["merge", 2, 9];
    expect(reach([event(1), event(5)], [wait])).toBe(9);
  });

  it("is the latest event when no wait is open", () => {
    expect(reach([event(1), event(5)], [])).toBe(5);
  });
});

describe("select", () => {
  const own = [event(10), event(20)];

  it("keeps every idea that reaches into the window when no ideas are named", () => {
    const kept = select(new Map([["#1", own]]), ALL_IDEAS, [0, 100], 500);
    expect(kept).toEqual(new Map([["#1", { own, waits: [] }]]));
  });

  it("keeps only the named ideas", () => {
    const byIdea = new Map([
      ["#1", own],
      ["#2", own],
    ]);
    const kept = select(byIdea, { ...ALL_IDEAS, ideas: ["#2"] }, [0, 100], 500);
    expect([...kept.keys()]).toEqual(["#2"]);
  });

  it("drops an idea whose first event is at or after the window's end", () => {
    const late = [event(100)];
    const kept = select(new Map([["#9", late]]), ALL_IDEAS, [0, 100], 500);
    expect(kept.size).toBe(0);
  });

  it("drops an idea that ended before the window and has no open wait", () => {
    const early = [event(5)];
    const kept = select(new Map([["#3", early]]), ALL_IDEAS, [50, 100], 500);
    expect(kept.size).toBe(0);
  });

  it("keeps an idea whose open wait reaches into the window after its events end", () => {
    const early = [event(5)];
    const wait: GithubWait = ["merge", 5, 60];
    vi.mocked(githubSpans).mockReturnValue([wait]);
    const kept = select(new Map([["#3", early]]), ALL_IDEAS, [50, 100], 500);
    expect(kept.get("#3")).toEqual({ own: early, waits: [wait] });
  });

  it("measures each idea's open waits to the report's asOf time", () => {
    select(new Map([["#1", own]]), ALL_IDEAS, [0, 100], 777);
    expect(githubSpans).toHaveBeenCalledWith(own, 777);
  });
});
