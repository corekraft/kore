import { describe, expect, it } from "vitest";
import { buildReport, type FlowReport } from "./report.js";
import { T0, at } from "../testing/index.js";
import type { LedgerEvent } from "../ledger/index.js";

const ASOF = new Date(T0 + 1_000_000_000);

const report = (events: LedgerEvent[], options = {}): FlowReport =>
  buildReport(events, { asOf: ASOF, minCompletedIdeas: 1, ...options });

const merged = (n: number, s: number) =>
  at(s, "pr.merged", { number: n, idea: `#${n}` });
const MIN = 60;

describe("outcome metrics no agent can set", () => {
  it("main-red rate is failed check runs over concluded check runs on main", () => {
    const r = report([
      at(0, "ci.main", { outcome: "success" }),
      at(10, "ci.main", { outcome: "failure" }),
      at(20, "ci.main", { outcome: "success" }),
      at(30, "ci.main", { outcome: "success" }),
    ]);
    expect(r.outcomes.mainRed).toEqual({ runs: 4, failed: 1, rate: 0.25 });
  });

  it("live-run pass rate is passed nightly runs over concluded nightly runs", () => {
    const r = report([
      at(0, "ci.nightly", { outcome: "success" }),
      at(10, "ci.nightly", { outcome: "failure" }),
      at(20, "ci.nightly", { outcome: "success" }),
    ]);
    expect(r.outcomes.liveRuns.runs).toBe(3);
    expect(r.outcomes.liveRuns.passed).toBe(2);
    expect(r.outcomes.liveRuns.rate).toBeCloseTo(2 / 3, 4);
  });

  it("reverts are counted per merged change", () => {
    const r = report([
      merged(1, 0),
      merged(2, 10),
      merged(3, 20),
      merged(4, 30),
      at(40, "main.revert"),
    ]);
    expect(r.outcomes.reverts).toEqual({ reverts: 1, merged: 4, rate: 0.25 });
  });

  it("a rate is null, never zero, when nothing was measured", () => {
    const r = report([]);
    expect(r.outcomes).toEqual({
      mainRed: { runs: 0, failed: 0, rate: null },
      reverts: { reverts: 0, merged: 0, rate: null },
      liveRuns: { runs: 0, passed: 0, rate: null },
      ownerMinutes: {
        minutes: 0,
        merged: 0,
        perMerged: null,
        burstGapMinutes: 10,
        upperBound: true,
      },
    });
  });

  it("counts only events inside --since and --until", () => {
    const r = report(
      [
        at(0, "ci.main", { outcome: "failure" }),
        at(100, "ci.main", { outcome: "success" }),
        at(200, "ci.main", { outcome: "success" }),
      ],
      {
        since: new Date(T0 + 50_000),
        until: new Date(T0 + 150_000),
      },
    );
    expect(r.outcomes.mainRed).toEqual({ runs: 1, failed: 0, rate: 0 });
  });

  it("is not stage time, an idea or an unmapped event", () => {
    const r = report([
      at(0, "ci.main", { outcome: "failure" }),
      at(1, "owner.action", { number: 3 }),
      at(2, "main.revert"),
    ]);
    expect(r.unmappedEvents).toBe(0);
    expect(r.ideas.total).toBe(0);
  });
});

describe("owner minutes count only work on ideas", () => {
  const minutes = (events: LedgerEvent[]) =>
    report(events).outcomes.ownerMinutes.minutes;

  it("counts actions on an idea's issue and on a pull request that closes one", () => {
    expect(
      minutes([
        at(0, "issue.opened", { number: 5 }),
        at(1, "pr.opened", { number: 105, idea: "#5" }),
        at(10, "owner.action", { number: 5 }),
        at(60 * MIN, "owner.action", { number: 105 }),
      ]),
    ).toBe(2);
  });

  it("does not count actions on an issue or pull request that is no idea's", () => {
    expect(
      minutes([
        at(0, "issue.opened", { number: 5 }),
        at(1, "pr.opened", { number: 200 }),
        at(10, "owner.action", { number: 99 }),
        at(60 * MIN, "owner.action", { number: 200 }),
      ]),
    ).toBe(0);
  });
});

describe("owner minutes per merged change", () => {
  it("joins actions less than ten minutes apart into one burst and charges its length", () => {
    const r = report([
      at(0, "issue.opened", { number: 1 }),
      at(0, "issue.opened", { number: 2 }),
      at(0, "owner.action", { number: 1 }),
      at(5 * MIN, "owner.action", { number: 1 }),
      at(14 * MIN, "owner.action", { number: 2 }),
      merged(1, 20 * MIN),
    ]);
    expect(r.outcomes.ownerMinutes).toMatchObject({
      minutes: 14,
      merged: 1,
      perMerged: 14,
      upperBound: true,
    });
  });

  it("starts a new burst after a gap of ten minutes or more, and charges a lone action one minute", () => {
    const r = report([
      at(0, "issue.opened", { number: 1 }),
      at(0, "issue.opened", { number: 2 }),
      at(0, "owner.action", { number: 1 }),
      at(10 * MIN, "owner.action", { number: 1 }),
      at(40 * MIN, "owner.action", { number: 2 }),
      merged(1, 50 * MIN),
      merged(2, 51 * MIN),
    ]);
    expect(r.outcomes.ownerMinutes).toMatchObject({
      minutes: 3,
      merged: 2,
      perMerged: 1.5,
    });
  });

  it("has no per-change figure when nothing merged", () => {
    const r = report([
      at(0, "issue.opened", { number: 1 }),
      at(0, "owner.action", { number: 1 }),
    ]);
    expect(r.outcomes.ownerMinutes).toMatchObject({
      minutes: 1,
      merged: 0,
      perMerged: null,
    });
  });
});

describe("guard blocks per rule", () => {
  it("counts blocks by rule name, most blocked first", () => {
    const r = report([
      at(0, "guard.block", { label: "destructive", session: "s1" }),
      at(1, "guard.block", { label: "bare-glob", session: "s1" }),
      at(2, "guard.block", { label: "destructive", session: "s1" }),
    ]);
    expect(r.guardBlocks).toEqual([
      { rule: "destructive", blocks: 2 },
      { rule: "bare-glob", blocks: 1 },
    ]);
  });
});

describe("attribution is measured from when sessions were stamped", () => {
  const unstamped = (s: number) =>
    at(s, "tool.start", { session: "s1", pane: "w3:p4", tool: "Bash" });
  const stamped = (s: number, idea?: string) =>
    at(s, "tool.start", {
      session: idea === undefined ? "s3" : "s2",
      pane: idea === undefined ? "w3:p6" : "w3:p5",
      agent: "x-writer",
      tool: "Bash",
      ...(idea === undefined ? {} : { idea }),
    });

  it("leaves out events recorded before the first stamped one, and says where it starts", () => {
    const r = report([
      unstamped(0),
      unstamped(1),
      stamped(10, "#7"),
      stamped(11),
    ]);
    expect(r.attribution).toEqual({
      since: new Date(T0 + 10_000).toISOString(),
      events: 2,
      withIdea: 1,
      withIdeaAndStage: 1,
    });
  });

  it("measures nothing while no session has been stamped: historical events stay unattributed", () => {
    expect(report([unstamped(0), unstamped(1)]).attribution).toEqual({
      since: null,
      events: 0,
      withIdea: 0,
      withIdeaAndStage: 0,
    });
  });
});

describe("attribution", () => {
  it("reports how many events carry an idea and a stage, from the stamped agent and idea", () => {
    const r = report([
      at(0, "tool.start", {
        session: "s1",
        pane: "w3:p4",
        agent: "flow-metrics-writer",
        idea: "#338",
        tool: "Bash",
      }),
      at(1, "tool.end", {
        session: "s1",
        pane: "w3:p4",
        agent: "flow-metrics-writer",
        idea: "#338",
        tool: "Bash",
        outcome: "success",
      }),
      at(2, "tool.start", {
        session: "s9",
        pane: "w3:p5",
        agent: "other-judge",
        tool: "Bash",
      }),
    ]);
    expect(r.attribution).toMatchObject({
      events: 3,
      withIdea: 2,
      withIdeaAndStage: 2,
    });
    expect(r.stages.find((s) => s.stage === "write")?.events).toBe(2);
  });

  it("gives a claude event the agent its pane was last named, so older ledgers still map", () => {
    const r = report([
      at(0, "pane.spawned", { pane: "w3:p4", agent: "x-writer", idea: "#7" }),
      at(1, "tool.start", { session: "s1", pane: "w3:p4", tool: "Bash" }),
      at(2, "tool.end", {
        session: "s1",
        pane: "w3:p4",
        tool: "Bash",
        outcome: "success",
      }),
    ]);
    expect(r.stages.find((s) => s.stage === "write")?.events).toBe(3);
  });

  it("does not hand a pane's agent to events from before it was named", () => {
    const r = report([
      at(0, "tool.start", { session: "s1", pane: "w3:p4", tool: "Bash" }),
      at(5, "pane.spawned", { pane: "w3:p4", agent: "x-writer", idea: "#7" }),
    ]);
    expect(r.stages.find((s) => s.stage === "write")?.events).toBe(1);
  });
});
