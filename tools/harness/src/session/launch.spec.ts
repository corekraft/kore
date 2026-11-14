import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps, RunResult, Runner } from "../runtime/index.js";
import { checkModel, startAgent } from "./agent-start.js";
import { buildBrief } from "./brief.js";
import { describeFailure } from "./equalize.js";
import { launch, type Launch } from "./launch.js";

vi.mock("./agent-start.js");
vi.mock("./brief.js");
vi.mock("./equalize.js");

const LEFT_OPEN = "Pane w3:p9 is left open.";
const LAUNCH: Launch = {
  role: "writer",
  model: "claude-opus-5-5",
  effort: "high",
  name: "image-trust-writer",
  brief: "Do the thing.",
  paneId: "w3:p9",
  callerPane: "w3:p1",
  leftOpen: LEFT_OPEN,
};
const START_ARGS = [
  "agent",
  "start",
  "image-trust-writer",
  "--kind",
  "claude",
  "--pane",
  "w3:p9",
  "--",
  "--agent",
  "writer",
  "--model",
  "claude-opus-5-5",
  "--effort",
  "high",
];
const PROMPT = [
  "agent",
  "prompt",
  "image-trust-writer",
  "BRIEF",
  "--wait",
  "--until",
  "working",
  "--timeout",
  "5000",
];
const WAIT = [
  "agent",
  "wait",
  "image-trust-writer",
  "--until",
  "working",
  "--timeout",
  "5000",
];
const VERIFIED = { status: "verified" } as const;

/**
 * A runner that answers each call with the next partial result, then succeeds;
 * a typed mock, so each call is recorded for the assertions.
 */
function runner(...answers: Partial<RunResult>[]) {
  const queue = [...answers];
  const run = vi.fn<Runner["run"]>(() =>
    Promise.resolve({ stdout: "", stderr: "", code: 0, ...queue.shift() }),
  );
  // Only the runner is read; startAgent and checkModel are mocked.
  return { deps: { runner: { run } } as unknown as CliDeps, run };
}

beforeEach(() => {
  vi.mocked(startAgent).mockResolvedValue(undefined);
  vi.mocked(checkModel).mockResolvedValue(VERIFIED);
  vi.mocked(buildBrief).mockReturnValue("BRIEF");
  vi.mocked(describeFailure).mockImplementation((result) => result.stderr);
});

describe("launch starts the agent and checks its model before the brief", () => {
  it("starts claude at the role, model and effort in the pane, then returns the verified check", async () => {
    const r = runner();
    expect(await launch(r.deps, LAUNCH)).toEqual(VERIFIED);
    expect(startAgent).toHaveBeenCalledWith(r.deps, START_ARGS);
    expect(checkModel).toHaveBeenCalledWith(
      r.deps,
      "image-trust-writer",
      "claude-opus-5-5",
    );
  });

  it("returns the start failure with the hint to leave the pane open, and goes no further", async () => {
    vi.mocked(startAgent).mockResolvedValue(
      "herdr agent start failed after 10 tries: boom",
    );
    const r = runner();
    expect(await launch(r.deps, LAUNCH)).toEqual({
      error: `herdr agent start failed after 10 tries: boom. ${LEFT_OPEN}`,
    });
    expect(checkModel).not.toHaveBeenCalled();
    expect(r.run).not.toHaveBeenCalled();
  });
});

describe("launch refuses a pane whose model is not the one requested", () => {
  it("returns the mismatch with the hint to leave the pane open, and sends no brief", async () => {
    const mismatch =
      'Session image-trust-writer runs "Haiku 5.5" but claude-opus-5-5 ("Opus 5.5") was requested.';
    vi.mocked(checkModel).mockResolvedValue({ mismatch });
    const r = runner();
    expect(await launch(r.deps, LAUNCH)).toEqual({
      error: `${mismatch} ${LEFT_OPEN}`,
    });
    expect(r.run).not.toHaveBeenCalled();
    expect(buildBrief).not.toHaveBeenCalled();
  });

  it("returns an unverified check as a pass with its reason, not as an error", async () => {
    const unverified = {
      status: "unverified",
      reason: "The pane showed no model name.",
    } as const;
    vi.mocked(checkModel).mockResolvedValue(unverified);
    expect(await launch(runner().deps, LAUNCH)).toEqual(unverified);
  });
});

describe("launch delivers the brief and waits for the session to start working", () => {
  it("builds the brief for the role and sends it with a prompt that waits until working", async () => {
    const r = runner();
    expect(await launch(r.deps, LAUNCH)).toEqual(VERIFIED);
    expect(buildBrief).toHaveBeenCalledWith({
      task: "Do the thing.",
      name: "image-trust-writer",
      callerPane: "w3:p1",
      role: "writer",
    });
    expect(r.run.mock.calls).toEqual([["herdr", PROMPT]]);
  });

  it("presses enter once when the brief sat unsubmitted, then returns the check once the session works", async () => {
    const r = runner({ code: 1, stderr: "input busy" }, {}, {});
    expect(await launch(r.deps, LAUNCH)).toEqual(VERIFIED);
    expect(r.run.mock.calls).toEqual([
      ["herdr", PROMPT],
      ["herdr", ["agent", "send-keys", "image-trust-writer", "enter"]],
      ["herdr", WAIT],
    ]);
  });

  it("names both failures and the pane left without its brief when enter does not start it either", async () => {
    const r = runner(
      { code: 1, stderr: "input busy" },
      {},
      { code: 1, stderr: "never started" },
    );
    expect(await launch(r.deps, LAUNCH)).toEqual({
      error:
        "herdr agent prompt failed: input busy; pressing enter did not start it either: never started. Session image-trust-writer is running in pane w3:p9 without its brief.",
    });
    expect(r.run).toHaveBeenCalledTimes(3);
  });
});
