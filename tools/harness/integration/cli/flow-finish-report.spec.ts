import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import {
  LEDGER_FILE as DEFAULT,
  ledgerHarness as harness,
} from "../../src/testing/index.js";
import { at } from "../../src/testing/index.js";
import {
  FINISH_DETECTION_KEYS,
  LAG_MINUTES_KEYS,
  STALLED_PANES_KEYS,
} from "./flow-report-keys-support.js";

const result = (ms: number, session: string, pane: string) =>
  at(ms, "session.result", { session, pane, result: "done" });
const finished = (ms: number, pane: string) =>
  at(ms, "pane.finished", { source: "herdr", pane, result: "done" });

/** Three results: one noticed, one late, one never noticed; then one recorded stall. */
function finishFixture() {
  const h = harness();
  const events = [
    // Noticed: the finish follows the result by 30 seconds, inside the window.
    result(0, "s1", "w3:p9"),
    finished(30, "w3:p9"),
    // Late: the pane's only finish follows the result by 20 minutes.
    result(60, "s2", "w3:p2"),
    finished(1260, "w3:p2"),
    // Never noticed: no pane.finished on its pane at all.
    result(120, "s3", "w3:p3"),
    at(130, "pane.stalled", { source: "herdr", pane: "w3:p5" }),
  ];
  h.fs.files.set(DEFAULT, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
  return h;
}

describe("flow report: finish detection and silent sessions (#1090)", () => {
  it("prints the noticed, never noticed and late split, the minutes lag and the silent sessions in text", async () => {
    const h = finishFixture();
    expect(await run(["flow", "report"], h.deps)).toBe(0);
    expect(h.out().split("\n")).toEqual(
      expect.arrayContaining([
        "Finish detection: 1 of 3 results noticed (a pane.finished recorded by session wait on the result's pane within the 300s placeholder window); never noticed 1, late 1",
        "Finish lag in minutes, detected and late: median 10.25, p90 20, over 2 finishes. Not a merge delay.",
        "Silent sessions: 0 (last token usage more than 900s earlier and no RESULT since; background-command excluded 0, open-question excluded 0); recorded pane.stalled: 1",
      ]),
    );
  });

  it("pins the finish detection and silent session keys, and their values, in JSON", async () => {
    const h = finishFixture();
    expect(await run(["flow", "report", "--json"], h.deps)).toBe(0);
    const report = JSON.parse(h.out()) as {
      finishDetection: Record<string, unknown>;
      stalledPanes: Record<string, unknown>;
    };
    expect(Object.keys(report.finishDetection)).toEqual(FINISH_DETECTION_KEYS);
    expect(Object.keys(report.finishDetection["lagMinutes"] as object)).toEqual(
      LAG_MINUTES_KEYS,
    );
    expect(Object.keys(report.stalledPanes)).toEqual(STALLED_PANES_KEYS);
    expect(report.finishDetection).toMatchObject({
      results: 3,
      detected: 1,
      undetected: 2,
      neverNoticed: 1,
      late: 1,
      lagMinutes: { samples: 2, median: 10.25, p90: 20 },
    });
    expect(report.stalledPanes).toMatchObject({
      recorded: 1,
      silentSessions: 0,
    });
  });
});
