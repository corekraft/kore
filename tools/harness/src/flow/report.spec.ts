import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildReport } from "./report.js";
import { firstTime, githubWaits, time } from "./github-waits.js";
import {
  firstClosed,
  guardBlocks,
  hostPressure,
  ideaMetrics,
  measureAttribution,
  outcomes,
  unstampedSpawns,
} from "./idea-metrics.js";
import { groupByIdea, select } from "./select.js";
import { inWindow, scopeOf, windowOf } from "./scope.js";
import { Tally } from "./tally.js";
import { chargeToil, newLife } from "./toil.js";
import {
  ASOF,
  SCOPE,
  WINDOW,
  cover,
  coverIdea,
  ev,
  fakeLife,
  fakeTally,
  run,
  writer,
} from "./report-support.js";

vi.mock("./github-waits.js");
vi.mock("./idea-metrics.js");
vi.mock("./select.js");
vi.mock("./scope.js");
vi.mock("./tally.js");
vi.mock("./toil.js");

beforeEach(() => {
  vi.mocked(scopeOf).mockReturnValue(SCOPE);
  vi.mocked(windowOf).mockReturnValue(WINDOW);
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockReturnValue(true);
  vi.mocked(newLife).mockReturnValue(fakeLife());
  cover(new Map());
  vi.mocked(unstampedSpawns).mockReturnValue({ total: 0, withReason: 0 });
});

describe("buildReport scope and ideas", () => {
  it("states the scope, as-of time and stages it was given, at the report version", () => {
    const tally = fakeTally();
    vi.mocked(tally.stages).mockReturnValue([]);
    const r = run([]);
    expect(r.version).toBe(17);
    expect(r.asOf).toBe("1970-01-01T00:00:01.000Z");
    expect(r.scope).toBe(SCOPE);
    expect(r.stages).toEqual([]);
    expect(scopeOf).toHaveBeenCalledWith({ asOf: ASOF, minCompletedIdeas: 1 });
  });

  it("counts a completed idea only when its outcome is inside the window", () => {
    fakeTally();
    const own1 = [ev(1, "issue.opened")];
    cover(
      new Map([
        ["#1", own1],
        ["#2", [ev(2, "issue.opened")]],
      ]),
    );
    vi.mocked(firstClosed)
      .mockReturnValueOnce(50)
      .mockReturnValueOnce(undefined);
    expect(run([], 0).ideas).toEqual({ total: 2, completed: 1 });
    expect(firstClosed).toHaveBeenCalledWith(own1);
  });

  it("gives the idea metrics the covered ideas and the report window", () => {
    fakeTally();
    const own = [ev(1, "issue.opened")];
    coverIdea(...own);
    run([]);
    expect(ideaMetrics).toHaveBeenCalledWith(
      new Map([["#1", own]]),
      WINDOW,
      undefined,
    );
  });
});

describe("buildReport unmapped events and reports", () => {
  it("counts unattributed events as unmapped when the report covers every idea", () => {
    fakeTally();
    cover(new Map(), [], 2);
    expect(run([]).unmappedEvents).toBe(2);
  });

  it("leaves unattributed events out of the unmapped count when ideas are named", () => {
    fakeTally();
    vi.mocked(scopeOf).mockReturnValue({ ...SCOPE, ideas: ["#1"] });
    cover(new Map(), [], 2);
    expect(run([]).unmappedEvents).toBe(0);
  });

  it("measures attribution over the covered events and the orphans of an unfiltered report", () => {
    fakeTally();
    const own = [ev(1, "issue.opened")];
    const orphan = ev(9, "tool.start");
    vi.mocked(groupByIdea).mockReturnValue({
      byIdea: new Map(),
      unattributed: 0,
      orphans: [orphan],
      named: [],
      landed: 42,
    });
    vi.mocked(select).mockReturnValue(new Map([["#1", { own, waits: [] }]]));
    run([]);
    expect(measureAttribution).toHaveBeenCalledWith(
      [own],
      [orphan],
      WINDOW,
      42,
      { hasStage: expect.any(Function), hasRole: expect.any(Function) },
    );
  });

  it("measures guard blocks and outcomes over every named event", () => {
    fakeTally();
    const named = [ev(1, "guard.block", { label: "rule" })];
    cover(new Map(), named);
    vi.mocked(guardBlocks).mockReturnValue([{ rule: "rule", blocks: 1 }]);
    expect(run([]).guardBlocks).toEqual([{ rule: "rule", blocks: 1 }]);
    expect(outcomes).toHaveBeenCalledWith(named, WINDOW);
  });
});

describe("buildReport host pressure", () => {
  it("reports host pressure over every named event, the window and the default trailing days", () => {
    fakeTally();
    const named = [ev(1, "host-sample", { sessions: 1, platform: false })];
    cover(new Map(), named);
    const pressure = { trailingDays: 7, samples: 1, levels: [] };
    vi.mocked(hostPressure).mockReturnValue(pressure);
    expect(run([]).hostPressure).toBe(pressure);
    expect(hostPressure).toHaveBeenCalledWith(named, WINDOW, {
      trailingDays: 7,
      asOf: ASOF,
    });
  });

  it("uses the trailing days it was given for the host baseline", () => {
    fakeTally();
    cover(new Map());
    buildReport([], { asOf: ASOF, minCompletedIdeas: 1, hostDays: 3 });
    expect(hostPressure).toHaveBeenCalledWith([], WINDOW, {
      trailingDays: 3,
      asOf: ASOF,
    });
  });
});

describe("buildReport attribution", () => {
  it("tells attribution which events a stage claims and which come from a role, and every merge lookup finds only a pull request merge", () => {
    fakeTally();
    coverIdea(ev(1, "issue.opened", { number: 1 }));
    run([]);
    const checks = vi.mocked(measureAttribution).mock.calls[0]?.[4];
    expect(checks?.hasStage(writer(2, "pane.spawned"), [])).toBe(true);
    expect(
      checks?.hasStage(ev(3, "tool.start", { source: "github" }), []),
    ).toBe(false);
    expect(checks?.hasRole(writer(2, "pane.spawned"))).toBe(true);
    for (const [, isMerge] of vi.mocked(firstTime).mock.calls) {
      const merged = [isMerge(ev(4, "pr.merged")), isMerge(ev(5, "pr.opened"))];
      expect(merged).toEqual([true, false]);
    }
  });
});

describe("buildReport stage mapping", () => {
  it("counts a GitHub event in its stage and marks it present at its instant", () => {
    const tally = fakeTally();
    coverIdea(ev(1, "issue.opened", { number: 1 }));
    run([]);
    expect(tally.count).toHaveBeenCalledWith("await approval");
    expect(tally.present).toHaveBeenCalledWith("await approval", 1, 1);
  });

  it("maps a pane by the role its name ends with", () => {
    const tally = fakeTally();
    coverIdea(ev(1, "pane.spawned", { pane: "idea-writer" }));
    run([]);
    expect(tally.count).toHaveBeenCalledWith("write");
  });

  it("maps a claude session with no agent to the orchestrate stage, the main session's", () => {
    const tally = fakeTally();
    coverIdea(ev(1, "session.start", { session: "s1" }));
    run([]);
    expect(tally.count).toHaveBeenCalledWith("orchestrate");
  });

  it("maps an issue label to await approval only for the approval label", () => {
    const tally = fakeTally();
    coverIdea(
      ev(1, "issue.labelled", { label: "ready-for-agent" }),
      ev(2, "issue.labelled", { label: "wontfix" }),
    );
    expect(run([]).unmappedEvents).toBe(1);
    expect(tally.count).toHaveBeenCalledWith("await approval");
  });

  it("maps the verifier only from the pull request's merge onward", () => {
    const tally = fakeTally();
    vi.mocked(firstTime).mockReturnValue(100);
    coverIdea(
      ev(50, "pane.spawned", { pane: "x-verifier" }),
      ev(150, "pane.spawned", { pane: "x-verifier" }),
    );
    expect(run([]).unmappedEvents).toBe(1);
    expect(tally.count).toHaveBeenCalledWith("verify");
  });

  it("counts a cost event in neither stage time nor the unmapped count", () => {
    const tally = fakeTally();
    coverIdea(ev(1, "token.usage"));
    expect(run([]).unmappedEvents).toBe(0);
    expect(tally.count).not.toHaveBeenCalled();
  });

  it("counts an event no stage claims, inside the window, as unmapped", () => {
    fakeTally();
    coverIdea(ev(1, "tool.start", { source: "github" }));
    expect(run([]).unmappedEvents).toBe(1);
  });
});

describe("buildReport actor time", () => {
  it("charges a pane's time between its events to the state it was in", () => {
    const tally = fakeTally();
    coverIdea(
      writer(0, "pane.spawned"),
      writer(10, "pane.busy"),
      writer(20, "pane.waiting"),
      writer(30, "pane.closed"),
    );
    run([]);
    expect(tally.add.mock.calls).toEqual([
      ["write", "activeMs", 0, 10],
      ["write", "activeMs", 10, 20],
      ["write", "waitingMs", 20, 30],
    ]);
    expect(tally.addToil).toHaveBeenCalledWith("write", "waiting", 20, 30);
  });

  it("does not charge a reused pane for the gap between its lives", () => {
    const tally = fakeTally();
    coverIdea(
      writer(0, "pane.spawned"),
      writer(10, "pane.closed"),
      writer(50, "pane.busy"),
      writer(60, "pane.spawned"),
      writer(100, "pane.closed"),
    );
    run([]);
    expect(tally.add.mock.calls).toEqual([
      ["write", "activeMs", 0, 10],
      ["write", "activeMs", 60, 100],
    ]);
  });

  it("passes the toil a life charges to the tally under the pane's stage", () => {
    const tally = fakeTally();
    vi.mocked(chargeToil).mockImplementation((add) => add("starting", 5));
    coverIdea(writer(0, "pane.spawned"));
    run([]);
    expect(tally.addToilMs).toHaveBeenCalledWith("write", "starting", 5);
  });
});

describe("buildReport GitHub waits", () => {
  it("holds GitHub waits out of a pane's lives, but not the main session's", () => {
    fakeTally();
    coverIdea(
      writer(0, "pane.spawned"),
      writer(30, "pane.closed"),
      ev(0, "session.start", { session: "s1" }),
      ev(40, "session.stop", { session: "s1" }),
    );
    run([]);
    expect(githubWaits).toHaveBeenCalledWith(expect.any(Tally), [], [[0, 30]]);
  });
});

describe("buildReport bottleneck", () => {
  it("names no bottleneck, with a note, below the minimum of completed ideas", () => {
    fakeTally();
    const r = run([], 3);
    expect(r.bottleneck).toBeNull();
    expect(r.bottleneckNote).toBe(
      "Not enough data: 0 of 3 completed ideas needed to name a bottleneck.",
    );
  });

  it("names no bottleneck when no waiting time was recorded", () => {
    fakeTally();
    expect(run([], 0).bottleneckNote).toBe(
      "No waiting time recorded, so there is no bottleneck.",
    );
  });

  it("names the stage with the most waiting, and its share of all waiting", () => {
    fakeTally({ write: 1000, merge: 2000, judge: 0 });
    expect(run([], 0).bottleneck).toEqual({
      stage: "merge",
      waitingSeconds: 2,
      share: 0.6667,
    });
  });

  it("names the earlier stage on an exact tie", () => {
    fakeTally({ write: 1000, merge: 1000 });
    expect(run([], 0).bottleneck).toEqual({
      stage: "write",
      waitingSeconds: 1,
      share: 0.5,
    });
  });
});
