import { describe, expect, it } from "vitest";
import { buildReport, type FlowReport } from "./report.js";
import { STAGES } from "./stages.js";
import { T0, at, finishedIdea } from "./flow-support.js";
import type { LedgerEvent } from "../ledger/index.js";

const ASOF = new Date(T0 + 1_000_000_000);

function report(events: LedgerEvent[], minCompletedIdeas = 1): FlowReport {
  return buildReport(events, { asOf: ASOF, minCompletedIdeas });
}

function stage(r: FlowReport, name: string) {
  const found = r.stages.find((s) => s.stage === name);
  if (found === undefined) {
    throw new Error(`no stage ${name}`);
  }
  return found;
}

describe("flow report stage mapping", () => {
  it("lists every stage in delivery order, zeroed, for an empty ledger", () => {
    const r = report([]);
    expect(r.version).toBe(2);
    expect(r.stages.map((s) => s.stage)).toEqual([...STAGES]);
    expect(
      r.stages.every(
        (s) =>
          s.activeSeconds === 0 && s.waitingSeconds === 0 && s.events === 0,
      ),
    ).toBe(true);
    expect(r.ideas).toEqual({ total: 0, completed: 0 });
    expect(r.unmappedEvents).toBe(0);
  });

  it.each([
    ["refiner", "refine"],
    ["challenger", "challenge"],
    ["orchestrator", "orchestrate"],
    ["writer", "write"],
    ["judge", "judge"],
  ])("maps a pane whose name ends in -%s to %s", (role, name) => {
    const pane = `subject-${role}`;
    const r = report([
      at(0, "pane.spawned", { pane, idea: "#1" }),
      at(30, "pane.closed", { pane, idea: "#1" }),
    ]);
    expect(stage(r, name)).toMatchObject({ activeSeconds: 30, events: 2 });
  });
});

describe("flow report pane roles and states", () => {
  it("maps a pane by its agent role or session name when the pane id has none", () => {
    const r = report([
      at(0, "pane.spawned", { pane: "w3:p2", agent: "judge", idea: "#1" }),
      at(20, "pane.closed", { pane: "w3:p2", agent: "judge", idea: "#1" }),
      at(0, "pane.spawned", { pane: "w3:p3", session: "x-writer", idea: "#1" }),
      at(5, "pane.closed", { pane: "w3:p3", session: "x-writer", idea: "#1" }),
    ]);
    expect(stage(r, "judge").activeSeconds).toBe(20);
    expect(stage(r, "write").activeSeconds).toBe(5);
  });

  it("splits a pane's time into active while busy and waiting while it waits on a person", () => {
    const pane = "idea-refiner";
    const r = report([
      at(0, "pane.spawned", { pane, idea: "#1" }),
      at(10, "pane.busy", { pane, idea: "#1" }),
      at(40, "pane.waiting", { pane, idea: "#1" }),
      at(100, "pane.busy", { pane, idea: "#1" }),
      at(160, "pane.closed", { pane, idea: "#1" }),
    ]);
    expect(stage(r, "refine")).toEqual({
      stage: "refine",
      activeSeconds: 100,
      waitingSeconds: 60,
      events: 5,
      toil: {
        startingSeconds: 0,
        stoppingSeconds: 0,
        waitingSeconds: 60,
        retryingSeconds: 0,
      },
    });
  });

  it("measures each spawn-to-close life of a reused pane, not the gap between them", () => {
    const pane = "idea-judge";
    const r = report([
      at(0, "pane.spawned", { pane, idea: "#1" }),
      at(10, "pane.closed", { pane, idea: "#1" }),
      at(100, "pane.spawned", { pane, idea: "#1" }),
      at(130, "pane.closed", { pane, idea: "#1" }),
      at(0, "pr.opened", { number: 5, idea: "#1" }),
      at(200, "pr.merged", { number: 5, idea: "#1" }),
    ]);
    expect(stage(r, "judge").activeSeconds).toBe(40);
    // Only the two lives, 10s and 30s, are carved out of the 200s PR wait.
    expect(stage(r, "merge").waitingSeconds).toBe(160);
  });

  it("counts no time after a pane closes", () => {
    const pane = "idea-writer";
    const r = report([
      at(0, "pane.spawned", { pane, idea: "#1" }),
      at(10, "pane.closed", { pane, idea: "#1" }),
      at(500, "tool.start", { pane, idea: "#1", tool: "Bash" }),
    ]);
    expect(stage(r, "write").activeSeconds).toBe(10);
  });
});

describe("flow report attribution", () => {
  it("maps the main session, a claude session with no pane, to orchestrate", () => {
    const r = report([
      at(0, "session.start", { session: "main", idea: "#1" }),
      at(20, "tool.start", { session: "main", tool: "Bash" }),
      at(50, "session.stop", { session: "main", idea: "#1" }),
    ]);
    expect(stage(r, "orchestrate")).toMatchObject({
      activeSeconds: 50,
      events: 3,
    });
  });

  it("attributes tool events to the idea their pane or session carries elsewhere", () => {
    const r = report([
      at(0, "pane.spawned", { pane: "a-writer", idea: "#7" }),
      at(5, "tool.start", { pane: "a-writer", tool: "Edit" }),
      at(9, "pane.closed", { pane: "a-writer" }),
    ]);
    expect(stage(r, "write")).toMatchObject({ events: 3, activeSeconds: 9 });
    expect(r.unmappedEvents).toBe(0);
    expect(r.ideas.total).toBe(1);
  });
});

describe("flow report GitHub waits", () => {
  it("holds an issue in await approval, as waiting, until the approval label", () => {
    const r = report([
      at(0, "issue.opened", { number: 1 }),
      at(900, "issue.labelled", { number: 1, label: "needs-triage" }),
      at(1000, "issue.labelled", { number: 1, label: "ready-for-agent" }),
    ]);
    expect(stage(r, "await approval")).toMatchObject({
      waitingSeconds: 1000,
      activeSeconds: 0,
      events: 2,
    });
    expect(r.unmappedEvents).toBe(1);
  });

  it("does not count refine or challenge time twice as await approval", () => {
    const r = report([
      at(0, "issue.opened", { number: 1 }),
      at(100, "pane.spawned", { pane: "s-refiner", idea: "#1" }),
      at(300, "pane.closed", { pane: "s-refiner", idea: "#1" }),
      at(1000, "issue.labelled", { number: 1, label: "ready-for-agent" }),
    ]);
    expect(stage(r, "await approval").waitingSeconds).toBe(800);
    expect(stage(r, "refine").activeSeconds).toBe(200);
  });

  it("keeps an unapproved issue waiting up to the report time", () => {
    const r = buildReport([at(0, "issue.opened", { number: 4 })], {
      asOf: new Date(T0 + 7200_000),
      minCompletedIdeas: 1,
    });
    expect(stage(r, "await approval").waitingSeconds).toBe(7200);
  });

  it("holds a pull request in merge, as waiting, until it merges, attributed to the issue it closes", () => {
    const r = report([
      at(0, "pr.opened", { number: 5, idea: "#1" }),
      at(600, "pr.merged", { number: 5, idea: "#1" }),
    ]);
    expect(stage(r, "merge")).toMatchObject({ waitingSeconds: 600, events: 2 });
    expect(r.ideas.total).toBe(1);
  });

  it("leaves judge time out of merge waiting", () => {
    const r = report([
      at(0, "pr.opened", { number: 5, idea: "#1" }),
      at(100, "pane.spawned", { pane: "s-judge", idea: "#1" }),
      at(220, "pane.closed", { pane: "s-judge", idea: "#1" }),
      at(600, "pr.merged", { number: 5, idea: "#1" }),
    ]);
    expect(stage(r, "merge").waitingSeconds).toBe(480);
    expect(stage(r, "judge").activeSeconds).toBe(120);
  });
});

describe("flow report verify, outcome and unmapped events", () => {
  it("maps a verifier pane to verify only after the pull request merged", () => {
    const events = [
      at(0, "pr.opened", { number: 5, idea: "#1" }),
      at(50, "pane.spawned", { pane: "s-verifier", idea: "#1" }),
      at(60, "pane.closed", { pane: "s-verifier", idea: "#1" }),
      at(100, "pr.merged", { number: 5, idea: "#1" }),
      at(110, "pane.spawned", { pane: "s-verifier", idea: "#1" }),
      at(140, "pane.closed", { pane: "s-verifier", idea: "#1" }),
    ];
    const r = report(events);
    expect(stage(r, "verify")).toMatchObject({ activeSeconds: 30, events: 2 });
    expect(r.unmappedEvents).toBe(2);
  });

  it("maps a closed issue to outcome and counts the idea as completed", () => {
    const r = report([
      at(0, "issue.opened", { number: 1 }),
      at(10, "issue.closed", { number: 1 }),
    ]);
    expect(stage(r, "outcome")).toMatchObject({ events: 1, activeSeconds: 0 });
    expect(r.ideas).toEqual({ total: 1, completed: 1 });
  });

  it("reports events it cannot map, and unattributed events, with a count", () => {
    const r = report([
      at(0, "pane.spawned", { pane: "w3:p9", idea: "#1" }),
      at(1, "pane.closed", { pane: "w3:p9", idea: "#1" }),
      at(2, "pane.busy", { pane: "x-writer" }),
      at(3, "pr.opened", { number: 8 }),
    ]);
    expect(r.unmappedEvents).toBe(4);
    expect(r.ideas.total).toBe(1);
  });
});

describe("flow report bottleneck", () => {
  it("names the stage with the largest share of waiting, a person's approval included", () => {
    const events = [
      ...finishedIdea(1, { approval: 3000 }),
      ...finishedIdea(2, { approval: 1000 }, 10_000),
      ...finishedIdea(3, { approval: 2000 }, 20_000),
    ];
    const r = report(events, 3);
    expect(r.ideas.completed).toBe(3);
    expect(r.bottleneck).toMatchObject({ stage: "await approval" });
    const waiting = r.stages.reduce((sum, s) => sum + s.waitingSeconds, 0);
    expect(r.bottleneck?.share).toBeCloseTo(
      stage(r, "await approval").waitingSeconds / waiting,
      3,
    );
    expect(r.bottleneck?.share).toBeGreaterThan(0.5);
    expect(r.bottleneckNote).toBeNull();
  });

  it("names merge when pull requests wait longer than approvals", () => {
    const events = [
      ...finishedIdea(1, { approval: 10, merge: 5000 }),
      ...finishedIdea(2, { approval: 10, merge: 4000 }, 10_000),
    ];
    expect(report(events, 2).bottleneck?.stage).toBe("merge");
  });

  it("counts a pane waiting on a person as waiting time that can be the bottleneck", () => {
    const pane = "s-writer";
    const r = report(
      [
        at(0, "pane.spawned", { pane, idea: "#1" }),
        at(5, "pane.waiting", { pane, idea: "#1" }),
        at(905, "pane.closed", { pane, idea: "#1" }),
        at(906, "issue.closed", { number: 1 }),
      ],
      1,
    );
    expect(r.bottleneck).toMatchObject({ stage: "write", share: 1 });
  });
});

describe("flow report bottleneck ties and gaps", () => {
  it("names the earlier stage on an exact tie, summing whole milliseconds", () => {
    const r = report(
      [
        at(0, "issue.opened", { number: 1 }),
        at(0.3, "issue.labelled", { number: 1, label: "ready-for-agent" }),
        at(0, "pr.opened", { number: 5, idea: "#2" }),
        at(0.1, "pr.merged", { number: 5, idea: "#2" }),
        at(0, "pr.opened", { number: 6, idea: "#3" }),
        at(0.2, "pr.merged", { number: 6, idea: "#3" }),
        at(1, "issue.closed", { number: 1 }),
      ],
      1,
    );
    expect(stage(r, "merge").waitingSeconds).toBe(0.3);
    expect(r.bottleneck?.stage).toBe("await approval");
  });

  it("names no bottleneck below the minimum number of completed ideas", () => {
    const r = report(
      [
        ...finishedIdea(1, { approval: 3000 }),
        ...finishedIdea(2, { approval: 1000 }, 10_000),
      ],
      3,
    );
    expect(r.bottleneck).toBeNull();
    expect(r.bottleneckNote).toBe(
      "Not enough data: 2 of 3 completed ideas needed to name a bottleneck.",
    );
  });

  it("invents no bottleneck from an empty ledger", () => {
    const r = report([], 3);
    expect(r.bottleneck).toBeNull();
    expect(r.bottleneckNote).toContain("0 of 3");
  });

  it("names no bottleneck when no waiting time was recorded", () => {
    const r = report([at(0, "issue.closed", { number: 1 })], 1);
    expect(r.bottleneck).toBeNull();
    expect(r.bottleneckNote).toBe(
      "No waiting time recorded, so there is no bottleneck.",
    );
  });
});
