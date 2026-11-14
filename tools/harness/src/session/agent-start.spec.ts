import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps, RunResult, Runner } from "../runtime/index.js";
import { checkModel, startAgent } from "./agent-start.js";
import { describeFailure } from "./equalize.js";
import { displayName, modelOnScreen } from "./models.js";

vi.mock("./equalize.js");
vi.mock("./models.js");

const START = ["agent", "start", "image-trust-writer"];
const MODEL = "claude-opus-5-5";
const READ = ["agent", "read", "image-trust-writer", "--source", "visible"];
const started: RunResult = { code: 0, stdout: "", stderr: "" };
const failure = (n: number): RunResult => ({
  code: 1,
  stdout: "",
  stderr: `try ${n}`,
});

/**
 * Deps whose runner answers each call with the next result, the last one
 * repeating, and whose clock advances only when something sleeps. Only what
 * these units touch is set; the rest of CliDeps is never read.
 */
function scripted(results: readonly RunResult[]) {
  let call = 0;
  let time = 0;
  const run = vi.fn<Runner["run"]>(() => {
    const result = results[Math.min(call, results.length - 1)] ?? started;
    call += 1;
    return Promise.resolve(result);
  });
  const sleep = vi.fn<CliDeps["clock"]["sleep"]>((ms) => {
    time += ms;
    return Promise.resolve();
  });
  const deps: Pick<CliDeps, "runner" | "clock"> = {
    runner: { run },
    clock: { now: () => new Date(time), sleep },
  };
  return { deps: deps as CliDeps, run, sleep };
}

beforeEach(() => {
  vi.mocked(describeFailure).mockImplementation(
    (result) => `described ${result.stderr}`,
  );
  vi.mocked(displayName).mockReturnValue("Opus 5.5");
  vi.mocked(modelOnScreen).mockReturnValue({ status: "none" });
});

describe("startAgent retries a failed agent start", () => {
  it("starts on the first try without pausing", async () => {
    const s = scripted([started]);
    expect(await startAgent(s.deps, START)).toBeUndefined();
    expect(s.run.mock.calls).toEqual([["herdr", START]]);
    expect(s.sleep).not.toHaveBeenCalled();
  });

  it("returns no error once a later try starts the agent", async () => {
    const s = scripted([failure(1), failure(2), started]);
    expect(await startAgent(s.deps, START)).toBeUndefined();
    expect(s.run).toHaveBeenCalledTimes(3);
    expect(s.sleep.mock.calls).toEqual([[1000], [1000]]);
  });

  it("retries a failure that is not agent_pane_busy", async () => {
    const s = scripted([
      { code: 1, stdout: "", stderr: "pane not ready" },
      started,
    ]);
    expect(await startAgent(s.deps, START)).toBeUndefined();
    expect(s.run).toHaveBeenCalledTimes(2);
  });

  it("makes ten tries one second apart, then reports only the last error", async () => {
    const s = scripted(Array.from({ length: 10 }, (_, i) => failure(i + 1)));
    expect(await startAgent(s.deps, START)).toBe(
      "herdr agent start failed after 10 tries: described try 10",
    );
    expect(s.run).toHaveBeenCalledTimes(10);
    expect(s.sleep.mock.calls).toEqual(Array.from({ length: 9 }, () => [1000]));
  });
});

describe("checkModel confirms the model the pane shows", () => {
  it("verifies the requested model's name on the first read, without waiting", async () => {
    vi.mocked(modelOnScreen).mockReturnValue({ status: "verified" });
    const s = scripted([started]);
    expect(await checkModel(s.deps, "image-trust-writer", MODEL)).toEqual({
      status: "verified",
    });
    expect(s.run.mock.calls).toEqual([["herdr", READ]]);
    expect(s.sleep).not.toHaveBeenCalled();
  });

  it("reports a mismatch naming the model the pane runs and the one requested", async () => {
    vi.mocked(modelOnScreen).mockReturnValue({
      status: "mismatch",
      seen: "Haiku 5.5",
    });
    const s = scripted([started]);
    expect(await checkModel(s.deps, "image-trust-writer", MODEL)).toEqual({
      mismatch:
        'Session image-trust-writer runs "Haiku 5.5" but claude-opus-5-5 ("Opus 5.5") was requested.',
    });
    expect(s.sleep).not.toHaveBeenCalled();
  });

  it("reports unverified, never a pass, for a model with no display name, and reads nothing", async () => {
    vi.mocked(displayName).mockReturnValue(undefined);
    const s = scripted([started]);
    expect(
      await checkModel(s.deps, "image-trust-writer", "claude-future-9"),
    ).toEqual({
      status: "unverified",
      reason:
        "No display name is known for claude-future-9, so the pane's model could not be confirmed.",
    });
    expect(s.run).not.toHaveBeenCalled();
  });

  it("keeps reading, half a second apart, until the name shows", async () => {
    vi.mocked(modelOnScreen)
      .mockReturnValueOnce({ status: "none" })
      .mockReturnValueOnce({ status: "none" })
      .mockReturnValueOnce({ status: "verified" });
    const s = scripted([started]);
    expect(await checkModel(s.deps, "image-trust-writer", MODEL)).toEqual({
      status: "verified",
    });
    expect(s.run).toHaveBeenCalledTimes(3);
    expect(s.sleep.mock.calls).toEqual([[500], [500]]);
  });

  it("gives up after five seconds, reporting unverified with the reason", async () => {
    const s = scripted([started]);
    expect(await checkModel(s.deps, "image-trust-writer", MODEL)).toEqual({
      status: "unverified",
      reason:
        'The pane showed no model name, such as "Opus 5.5", within 5 seconds, so claude-opus-5-5 could not be confirmed.',
    });
    expect(s.run).toHaveBeenCalledTimes(11);
    expect(s.sleep.mock.calls).toEqual(Array.from({ length: 10 }, () => [500]));
  });

  it("checks an empty screen when the read itself fails, so a failed read is never a pass", async () => {
    const s = scripted([failure(1)]);
    await checkModel(s.deps, "image-trust-writer", MODEL);
    expect(modelOnScreen).toHaveBeenCalledWith(MODEL, "");
    expect(
      vi.mocked(modelOnScreen).mock.calls.every(([, screen]) => screen === ""),
    ).toBe(true);
  });
});
