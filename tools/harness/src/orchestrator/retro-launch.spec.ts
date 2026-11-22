import { describe, expect, it } from "vitest";
import {
  PROPOSALS_BEGIN,
  PROPOSALS_END,
  RETRO_CAP,
} from "./retro-proposals.js";
import {
  retroBrief,
  RETRO_EFFORT,
  RETRO_FLAG,
  RETRO_MODEL,
  RETRO_REASON,
  RETRO_ROLE,
  RetroLaunch,
  type RetroPane,
  type RetroPorts,
  type RetroReport,
} from "./retro-launch.js";

const NOT_DUE: RetroReport = { due: false };
const DUE_COUNT: RetroReport = { due: true, reason: "count" };

/** Scripted ports that log every call in order. */
function ports(
  script: {
    flag?: boolean;
    report?: RetroReport;
    appended?: boolean;
    recordFails?: boolean;
    backend?: "herdr" | "hc";
  } = {},
) {
  const calls: string[] = [];
  const panes: RetroPane[] = [];
  const fake: RetroPorts = {
    flagOn: () => {
      calls.push("flag");
      return Promise.resolve(script.flag ?? true);
    },
    due: () => {
      calls.push("due");
      return Promise.resolve(script.report ?? DUE_COUNT);
    },
    record: (reason) => {
      calls.push(`record ${reason}`);
      return script.recordFails === true
        ? Promise.reject(new Error("ledger rejected"))
        : Promise.resolve({
            recordedAt: "2026-11-15T09:30:12Z",
            appended: script.appended ?? true,
          });
    },
    spawn: (pane) => {
      calls.push("spawn");
      panes.push(pane);
      return Promise.resolve();
    },
    backend: () => Promise.resolve(script.backend ?? "herdr"),
  };
  return { fake, calls, panes };
}

describe("RetroLaunch", () => {
  it("launches nothing and reads nothing while the flag is off", async () => {
    const { fake, calls } = ports({ flag: false });

    expect(await new RetroLaunch(fake).run()).toEqual({ status: "flag-off" });
    expect(calls).toEqual(["flag"]);
  });

  it("launches nothing when no retro is due, and records nothing", async () => {
    const { fake, calls } = ports({ report: NOT_DUE });

    expect(await new RetroLaunch(fake).run()).toEqual({ status: "not-due" });
    expect(calls).toEqual(["flag", "due"]);
  });

  it("records the trigger with its reason before it launches the pane", async () => {
    const { fake, calls } = ports();

    const result = await new RetroLaunch(fake).run();

    expect(calls).toEqual(["flag", "due", "record count", "spawn"]);
    expect(result).toEqual({
      status: "launched",
      reason: "count",
      name: "retro-20261115-0930",
    });
  });

  it("names a worsened metric in the recorded reason", async () => {
    const { fake, calls } = ports({
      report: { due: true, reason: "metric", metric: "tokensPerIdea" },
    });

    await new RetroLaunch(fake).run();

    expect(calls).toContain("record metric:tokensPerIdea");
  });
});

describe("RetroLaunch pane", () => {
  it("runs the retro pane on Sonnet at high effort and says why in the launch event", async () => {
    const { fake, panes } = ports();

    await new RetroLaunch(fake).run();

    expect(RETRO_MODEL).toBe("claude-sonnet-5-5");
    expect(RETRO_EFFORT).toBe("high");
    expect(panes).toEqual([
      {
        role: RETRO_ROLE,
        name: "retro-20261115-0930",
        model: RETRO_MODEL,
        effort: RETRO_EFFORT,
        reason: RETRO_REASON,
        brief: expect.stringContaining(
          "The trigger (count) is already recorded.",
        ),
      },
    ]);
    expect(RETRO_REASON.length).toBeLessThanOrEqual(100);
  });

  it("briefs an hc pane to finish with its proposals on the stdin of session report, never a RESULT line or a file", async () => {
    const { fake, panes } = ports({ backend: "hc" });

    await new RetroLaunch(fake).run();

    const brief = panes[0]?.brief ?? "";
    expect(brief).toContain(
      "then, as your last action, run `node skills/bin/harness.mjs session report --outcome done --summary - <<'EOF'` with your proposals on the lines after it, then a line that reads EOF.",
    );
    expect(brief).not.toMatch(/RESULT/);
  });

  it("briefs the pane to propose only and to end with its proposals as JSON between the markers", async () => {
    const { fake, panes } = ports();

    await new RetroLaunch(fake).run();

    const brief = panes[0]?.brief ?? "";
    expect(brief).toContain("Propose only; change no file and record nothing.");
    expect(brief).toContain(`${PROPOSALS_BEGIN}`);
    expect(brief).toContain(`${PROPOSALS_END}`);
    for (const field of [
      "title",
      "hypothesis",
      "expectedOutcome",
      "measurement",
      "safetyPattern",
      "metric",
      "direction",
      "window",
    ]) {
      expect(brief).toContain(field);
    }
  });

  it("launches no second pane for a trigger the ledger already holds", async () => {
    const { fake, calls, panes } = ports({ appended: false });

    expect(await new RetroLaunch(fake).run()).toEqual({
      status: "already-triggered",
    });
    expect(panes).toEqual([]);
    expect(calls).not.toContain("spawn");
  });

  it("launches no pane when the trigger cannot be recorded", async () => {
    const { fake, panes } = ports({ recordFails: true });

    await expect(new RetroLaunch(fake).run()).rejects.toThrow(
      "ledger rejected",
    );
    expect(panes).toEqual([]);
  });

  it("is switched by the automatic-retro flag", () => {
    expect(RETRO_FLAG).toBe("automatic-retro");
  });
});

describe("retroBrief", () => {
  it("keeps the herdr retro brief exactly as main wrote it, ending with its RESULT line", () => {
    expect(retroBrief("count")).toBe(
      `Run the /retro skill: review the sessions since the last retrospective and end with ranked proposals. Propose only; change no file and record nothing. The trigger (count) is already recorded. End with your proposals as one JSON array, one object per idea with the string fields title, hypothesis, expectedOutcome, measurement, safetyPattern, metric, direction (up or down) and window (such as 14d), between a line ${PROPOSALS_BEGIN} and a line ${PROPOSALS_END}, then print RESULT: done. A tool files the first ${RETRO_CAP} as ideas and drops the rest, so rank them.`,
    );
  });
});
