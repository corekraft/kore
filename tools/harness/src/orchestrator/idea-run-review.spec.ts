import { describe, expect, it } from "vitest";
import { IdeaRun } from "./idea-run.js";
import { OUTCOME, ScriptedHarness } from "./idea-run.fixtures.js";

describe("IdeaRun review", () => {
  it("runs the review on the PR before its precheck and before any judge pane", async () => {
    const harness = new ScriptedHarness();
    await new IdeaRun(harness).run("0042", OUTCOME);
    const at = (call: string) => harness.calls.indexOf(call);
    expect(at("review 50")).toBeGreaterThan(at("wait idea-0042-writer"));
    expect(at("review 50")).toBeLessThan(at("precheck 50"));
    expect(at("precheck 50")).toBeLessThan(at("spawn judge"));
  });

  it("reviews the new head again after the writer fixes a send-back", async () => {
    const harness = new ScriptedHarness({
      prechecks: [{ sendBack: true, reason: "ci: fail" }],
      deliveries: [
        { pr: 50, merged: false },
        { pr: 50, merged: true },
      ],
      counts: [1],
    });
    await new IdeaRun(harness).run("0042", OUTCOME);
    expect(harness.calls.filter((c) => c === "review 50")).toHaveLength(2);
  });

  it("stops the run with the review's error, and runs no precheck, judge or outcome", async () => {
    const harness = new ScriptedHarness({ reviewFailsOn: 1 });
    await expect(new IdeaRun(harness).run("0042", OUTCOME)).rejects.toThrow(
      /no verdict/,
    );
    expect(harness.calls).not.toContain("precheck 50");
    expect(harness.launches.map((l) => l.role)).toEqual(["writer"]);
    expect(harness.recorded).toEqual([]);
  });
});
