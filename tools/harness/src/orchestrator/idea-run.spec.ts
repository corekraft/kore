import { describe, expect, it } from "vitest";
import { IdeaRun } from "./idea-run.js";
import { OUTCOME, ScriptedHarness } from "./idea-run.fixtures.js";

describe("IdeaRun", () => {
  it("takes an approved idea from queue to a recorded outcome in one pass", async () => {
    const harness = new ScriptedHarness();
    const result = await new IdeaRun(harness).run("0042", OUTCOME);
    expect(result).toEqual({ status: "outcome-recorded", rounds: 1 });
    expect(harness.calls).toEqual([
      "queue",
      "spawn writer",
      "wait idea-0042-writer",
      "close idea-0042-writer",
      "delivery",
      "precheck 50",
      "spawn judge",
      "wait idea-0042-judge",
      "close idea-0042-judge",
      "delivery",
      "record-outcome",
    ]);
    expect(harness.recorded).toEqual([OUTCOME]);
  });

  it("reads the queue only between pieces of work, never while a pane runs", async () => {
    const harness = new ScriptedHarness({
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
    expect(harness.calls.filter((c) => c === "queue")).toHaveLength(2);
  });
});

describe("IdeaRun escalation", () => {
  it("relaunches the writer on Sonnet after two send-backs, and not before", async () => {
    const harness = new ScriptedHarness({
      deliveries: [
        { pr: 50, merged: false },
        { pr: 50, merged: false },
        { pr: 50, merged: true },
      ],
      counts: [1, 2],
    });
    const result = await new IdeaRun(harness).run("0042", OUTCOME);
    expect(result).toEqual({ status: "outcome-recorded", rounds: 3 });
    const writers = harness.launches.filter((l) => l.role === "writer");
    expect(writers.map((w) => w.model)).toEqual([
      undefined,
      undefined,
      "claude-sonnet-5-5",
    ]);
    expect(harness.calls.filter((c) => c.startsWith("escalate"))).toEqual([
      "escalate 50",
    ]);
  });

  it("gives every writer a worktree and the idea, and every pane its role", async () => {
    const harness = new ScriptedHarness();
    await new IdeaRun(harness).run("0042", OUTCOME);
    expect(harness.launches.map((l) => [l.role, l.issue, l.worktree])).toEqual([
      ["writer", 197, true],
      ["judge", 197, undefined],
    ]);
  });
});

describe("IdeaRun boundaries", () => {
  it("never merges or edits itself", async () => {
    const harness = new ScriptedHarness();
    await new IdeaRun(harness).run("0042", OUTCOME);
    expect(harness.calls.join("\n")).not.toMatch(/merge|edit/);
  });

  it("does nothing for an idea that is not queued", async () => {
    const harness = new ScriptedHarness({ queue: [] });
    const result = await new IdeaRun(harness).run("0042", OUTCOME);
    expect(result).toEqual({ status: "not-queued", rounds: 0 });
    expect(harness.calls).toEqual(["queue"]);
  });

  it("never records an outcome when no measured outcome was given, even after the merge", async () => {
    const harness = new ScriptedHarness();
    const result = await new IdeaRun(harness).run("0042", undefined);
    expect(result).toEqual({ status: "awaiting-outcome", rounds: 1 });
    expect(harness.calls).not.toContain("record-outcome");
  });

  it("stops without an outcome when a writer reports blocked", async () => {
    const harness = new ScriptedHarness({ waits: ["blocked"] });
    const result = await new IdeaRun(harness).run("0042", OUTCOME);
    expect(result).toEqual({ status: "blocked", rounds: 1 });
    expect(harness.calls).toEqual([
      "queue",
      "spawn writer",
      "wait idea-0042-writer",
      "close idea-0042-writer",
    ]);
  });

  it("stops without an outcome when the writer left no pull request", async () => {
    const harness = new ScriptedHarness({ deliveries: [{ merged: false }] });
    const result = await new IdeaRun(harness).run("0042", OUTCOME);
    expect(result).toEqual({ status: "blocked", rounds: 1 });
    expect(harness.calls).not.toContain("spawn judge");
    expect(harness.calls).not.toContain("record-outcome");
  });
});

describe("IdeaRun limits", () => {
  it("gives up after the round limit rather than looping, recording nothing", async () => {
    const harness = new ScriptedHarness({
      deliveries: [{ pr: 50, merged: false }],
      counts: [1, 2, 2, 2, 2, 2, 2, 2],
    });
    const result = await new IdeaRun(harness).run("0042", OUTCOME);
    expect(result).toEqual({ status: "gave-up", rounds: 6 });
    expect(harness.calls).not.toContain("record-outcome");
    expect(harness.calls.filter((c) => c.startsWith("escalate"))).toHaveLength(
      1,
    );
  });
});

describe("IdeaRun between pieces of work", () => {
  function withHook(harness: ScriptedHarness) {
    return new IdeaRun(harness, () => {
      harness.calls.push("between-work");
      return Promise.resolve();
    });
  }

  it("runs the between-work hook once, after the last pane is closed", async () => {
    const harness = new ScriptedHarness();
    await withHook(harness).run("0042", OUTCOME);
    expect(harness.calls.slice(-2)).toEqual(["record-outcome", "between-work"]);
    expect(harness.calls.filter((c) => c === "between-work")).toHaveLength(1);
  });

  it("never runs the hook while a pane runs, even across send-back rounds", async () => {
    const harness = new ScriptedHarness({
      deliveries: [
        { pr: 50, merged: false },
        { pr: 50, merged: true },
      ],
      counts: [1],
    });
    await withHook(harness).run("0042", OUTCOME);
    let running = false;
    for (const call of harness.calls) {
      if (call.startsWith("spawn")) {
        running = true;
      }
      if (call.startsWith("close")) {
        running = false;
      }
      expect(running && call === "between-work").toBe(false);
    }
    expect(harness.calls.filter((c) => c === "between-work")).toHaveLength(1);
  });

  it("runs the hook when the run stops blocked, since no pane is left running", async () => {
    const harness = new ScriptedHarness({ waits: ["blocked"] });
    await withHook(harness).run("0042", OUTCOME);
    expect(harness.calls.slice(-2)).toEqual([
      "close idea-0042-writer",
      "between-work",
    ]);
  });

  it("does not run the hook for an idea that is not queued", async () => {
    const harness = new ScriptedHarness({ queue: [] });
    await withHook(harness).run("0042", OUTCOME);
    expect(harness.calls).toEqual(["queue"]);
  });
});
