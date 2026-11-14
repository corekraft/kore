import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps, HostLoad, RunResult, Runner } from "../runtime/index.js";
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
function scripted(results: readonly RunResult[], hostLoad?: HostLoad) {
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
  const deps: Pick<CliDeps, "runner" | "clock"> & Partial<CliDeps> = {
    runner: { run },
    clock: { now: () => new Date(time), sleep },
    ...(hostLoad === undefined ? {} : { hostLoad }),
  };
  return { deps: deps as CliDeps, run, sleep };
}

/** A host load reader that answers the same one-minute average on every read. */
const loadAt = (average: number): HostLoad => ({ oneMinute: () => average });

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
    expect(s.sleep.mock.calls).toEqual([[1000], [2000]]);
  });

  it("retries a failure that is not agent_pane_busy", async () => {
    const s = scripted([
      { code: 1, stdout: "", stderr: "pane not ready" },
      started,
    ]);
    expect(await startAgent(s.deps, START)).toBeUndefined();
    expect(s.run).toHaveBeenCalledTimes(2);
  });
});

describe("startAgent backs off between failed tries", () => {
  it("doubles the pause from one second, and gives up once the total wait would pass sixty seconds", async () => {
    const s = scripted(
      Array.from({ length: 10 }, (_, i) => failure(i + 1)),
      loadAt(0.5),
    );
    expect(await startAgent(s.deps, START)).toBe(
      "herdr agent start failed after 7 tries over 60 s of waiting: described try 7. The host 1-minute load average is 0.50, so the pane may not have started in time under load. Wait for the load to fall, then spawn again.",
    );
    expect(s.run).toHaveBeenCalledTimes(7);
    expect(s.sleep.mock.calls).toEqual([
      [1000],
      [2000],
      [4000],
      [8000],
      [16000],
      [29000],
    ]);
  });

  it("pauses one, two and four seconds across three timed-out tries, then returns success", async () => {
    const s = scripted(
      [failure(1), failure(2), failure(3), started],
      loadAt(0.5),
    );
    expect(await startAgent(s.deps, START)).toBeUndefined();
    expect(s.run).toHaveBeenCalledTimes(4);
    expect(s.sleep.mock.calls).toEqual([[1000], [2000], [4000]]);
  });

  it("scales each pause with the host load, so a busy host waits longer", async () => {
    const s = scripted(
      Array.from({ length: 10 }, (_, i) => failure(i + 1)),
      loadAt(40),
    );
    expect(await startAgent(s.deps, START)).toBe(
      "herdr agent start failed after 5 tries over 60 s of waiting: described try 5. The host 1-minute load average is 40.00, so the pane may not have started in time under load. Wait for the load to fall, then spawn again.",
    );
    expect(s.run).toHaveBeenCalledTimes(5);
    expect(s.sleep.mock.calls).toEqual([[5000], [10000], [20000], [25000]]);
  });

  it("names the unreadable load instead of guessing it, and keeps the unscaled pauses", async () => {
    const s = scripted(
      Array.from({ length: 10 }, (_, i) => failure(i + 1)),
      loadAt(Number.POSITIVE_INFINITY),
    );
    expect(await startAgent(s.deps, START)).toBe(
      "herdr agent start failed after 7 tries over 60 s of waiting: described try 7. The host 1-minute load average cannot be read. Check the host load, then spawn again.",
    );
    expect(s.sleep.mock.calls).toEqual([
      [1000],
      [2000],
      [4000],
      [8000],
      [16000],
      [29000],
    ]);
  });

  it("reads the host load only when it pauses, so a first-try start reads nothing", async () => {
    const hostLoad = { oneMinute: vi.fn(() => 0.5) };
    const s = scripted([started], hostLoad);
    expect(await startAgent(s.deps, START)).toBeUndefined();
    expect(hostLoad.oneMinute).not.toHaveBeenCalled();
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
