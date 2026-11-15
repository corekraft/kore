import { describe, expect, it } from "vitest";
import { IdeaRun } from "./idea-run.js";
import { OUTCOME, ScriptedHarness } from "./idea-run.fixtures.js";

const FAIL = {
  sendBack: true,
  reason: "The precheck failed: ci: fail",
} as const;

describe("IdeaRun precheck", () => {
  it("launches the judge only after a passing precheck", async () => {
    const harness = new ScriptedHarness({ prechecks: [{ sendBack: false }] });
    await new IdeaRun(harness).run("0042", OUTCOME);
    expect(harness.calls.indexOf("precheck 50")).toBeLessThan(
      harness.calls.indexOf("spawn judge"),
    );
    expect(harness.calls).not.toContain("send-back 50");
  });

  it("sends a failing change back to its writer with the reason and launches no judge pane", async () => {
    const harness = new ScriptedHarness({
      prechecks: [FAIL],
      deliveries: [
        { pr: 50, merged: false },
        { pr: 50, merged: true },
      ],
      counts: [1],
    });
    await new IdeaRun(harness).run("0042", OUTCOME);
    expect(harness.reasons).toEqual(["The precheck failed: ci: fail"]);
    const judges = harness.launches.filter((l) => l.role === "judge");
    // Round 1 sent back with no judge; round 2 passed and launched one.
    expect(judges).toHaveLength(1);
    const firstSendBack = harness.calls.indexOf("send-back 50");
    expect(harness.calls.slice(0, firstSendBack)).not.toContain("spawn judge");
    expect(harness.launches.map((l) => l.role)).toEqual([
      "writer",
      "writer",
      "judge",
    ]);
  });

  it("counts a precheck send-back toward the writer's escalation, once per send-back", async () => {
    const harness = new ScriptedHarness({
      prechecks: [FAIL, FAIL],
      deliveries: [
        { pr: 50, merged: false },
        { pr: 50, merged: false },
        { pr: 50, merged: true },
      ],
      counts: [1, 2],
    });
    await new IdeaRun(harness).run("0042", OUTCOME);
    const writers = harness.launches.filter((l) => l.role === "writer");
    expect(writers.map((w) => w.model)).toEqual([
      undefined,
      undefined,
      "claude-sonnet-5-5",
    ]);
    expect(harness.calls.filter((c) => c === "escalate 50")).toHaveLength(1);
  });
});

describe("IdeaRun precheck send-back rounds", () => {
  it("never reads the queue while a pane runs, across a precheck send-back", async () => {
    const harness = new ScriptedHarness({
      prechecks: [FAIL],
      deliveries: [
        { pr: 50, merged: false },
        { pr: 50, merged: true },
      ],
      counts: [1],
    });
    await new IdeaRun(harness).run("0042", OUTCOME);
    let running = false;
    for (const call of harness.calls) {
      if (call.startsWith("spawn")) {
        running = true;
      }
      if (call.startsWith("close")) {
        running = false;
      }
      expect(running && call === "queue").toBe(false);
    }
  });
});
