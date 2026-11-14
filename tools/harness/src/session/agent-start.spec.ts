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
const timedOut = (n: number): RunResult => ({
  code: 1,
  stdout: "",
  stderr: `timed out, try ${n}`,
});

/**
 * Fake deps: the runner answers each call with the next result (the last one
 * repeating), and the clock advances only when something sleeps. The host load
 * reader is set only when given, as in a fake that no load check reads.
 */
function fakeDeps(results: readonly RunResult[], hostLoad?: HostLoad) {
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
  const parts: Pick<CliDeps, "runner" | "clock"> &
    Partial<Pick<CliDeps, "hostLoad">> = {
    runner: { run },
    clock: { now: () => new Date(time), sleep },
    ...(hostLoad === undefined ? {} : { hostLoad }),
  };
  // The one cast: fakes set only the parts these units touch, and CliDeps' rest is never read.
  return { deps: parts as CliDeps, run, sleep };
}

/** A host load reader that answers the same one-minute average on every read. */
const loadAt = (average: number): HostLoad => ({ oneMinute: () => average });

/** The pauses a timed-out start backs off through when the budget runs out (load 0 to 8). */
const BACKOFF_SLEEPS = [[1000], [2000], [4000], [8000], [16000], [29000]];

beforeEach(() => {
  vi.mocked(describeFailure).mockImplementation(
    (result) => `described ${result.stderr}`,
  );
  vi.mocked(displayName).mockReturnValue("Opus 5.5");
  vi.mocked(modelOnScreen).mockReturnValue({ status: "none" });
});

describe("startAgent retries a fast failure exactly as before", () => {
  it("starts on the first try without pausing", async () => {
    const s = fakeDeps([started]);
    expect(await startAgent(s.deps, START)).toBeUndefined();
    expect(s.run.mock.calls).toEqual([["herdr", START]]);
    expect(s.sleep).not.toHaveBeenCalled();
  });

  it("returns no error once a later try starts the agent, one second apart", async () => {
    const s = fakeDeps([failure(1), failure(2), started]);
    expect(await startAgent(s.deps, START)).toBeUndefined();
    expect(s.run).toHaveBeenCalledTimes(3);
    expect(s.sleep.mock.calls).toEqual([[1000], [1000]]);
  });

  it("retries a failure that is not agent_pane_busy", async () => {
    const s = fakeDeps([
      { code: 1, stdout: "", stderr: "pane not ready" },
      started,
    ]);
    expect(await startAgent(s.deps, START)).toBeUndefined();
    expect(s.run).toHaveBeenCalledTimes(2);
  });

  it("makes ten tries one second apart under load, then reports only the last error, with no load read", async () => {
    const hostLoad = { oneMinute: vi.fn(() => 40) };
    const s = fakeDeps(
      Array.from({ length: 10 }, (_, i) => failure(i + 1)),
      hostLoad,
    );
    expect(await startAgent(s.deps, START)).toBe(
      "herdr agent start failed after 10 tries: described try 10",
    );
    expect(s.run).toHaveBeenCalledTimes(10);
    expect(s.sleep.mock.calls).toEqual(Array.from({ length: 9 }, () => [1000]));
    expect(hostLoad.oneMinute).not.toHaveBeenCalled();
  });
});

describe("startAgent backs off once a start times out", () => {
  it("pauses one, two and four seconds across three timed-out tries, then returns success", async () => {
    const s = fakeDeps(
      [timedOut(1), timedOut(2), timedOut(3), started],
      loadAt(0.5),
    );
    expect(await startAgent(s.deps, START)).toBeUndefined();
    expect(s.run).toHaveBeenCalledTimes(4);
    expect(s.sleep.mock.calls).toEqual([[1000], [2000], [4000]]);
  });

  it("doubles the pause and gives up once the total wait would pass sixty seconds", async () => {
    const s = fakeDeps(
      Array.from({ length: 10 }, (_, i) => timedOut(i + 1)),
      loadAt(0.5),
    );
    expect(await startAgent(s.deps, START)).toBe(
      "herdr agent start failed after 7 tries over 60 s of waiting: described timed out, try 7. The host 1-minute load average is 0.50, so the pane may not have started in time under load. Wait for the load to fall, then spawn again.",
    );
    expect(s.run).toHaveBeenCalledTimes(7);
    expect(s.sleep.mock.calls).toEqual(BACKOFF_SLEEPS);
  });

  it("scales each pause with the host load, so a busy host waits longer", async () => {
    const s = fakeDeps(
      Array.from({ length: 10 }, (_, i) => timedOut(i + 1)),
      loadAt(40),
    );
    expect(await startAgent(s.deps, START)).toBe(
      "herdr agent start failed after 5 tries over 60 s of waiting: described timed out, try 5. The host 1-minute load average is 40.00, so the pane may not have started in time under load. Wait for the load to fall, then spawn again.",
    );
    expect(s.run).toHaveBeenCalledTimes(5);
    expect(s.sleep.mock.calls).toEqual([[5000], [10000], [20000], [25000]]);
  });

  it("keeps the one-second pause for fast failures before the first timeout", async () => {
    const s = fakeDeps(
      [failure(1), timedOut(2), timedOut(3), started],
      loadAt(0.5),
    );
    expect(await startAgent(s.deps, START)).toBeUndefined();
    expect(s.sleep.mock.calls).toEqual([[1000], [1000], [2000]]);
  });

  it("names an unreadable host load and keeps the unscaled pauses when no reader is injected", async () => {
    const s = fakeDeps(Array.from({ length: 10 }, (_, i) => timedOut(i + 1)));
    expect(await startAgent(s.deps, START)).toBe(
      "herdr agent start failed after 7 tries over 60 s of waiting: described timed out, try 7. The host 1-minute load average cannot be read. Check the host load, then spawn again.",
    );
    expect(s.sleep.mock.calls).toEqual(BACKOFF_SLEEPS);
  });

  it("names an unreadable host load when the reader reports none", async () => {
    const s = fakeDeps(
      Array.from({ length: 10 }, (_, i) => timedOut(i + 1)),
      loadAt(Number.POSITIVE_INFINITY),
    );
    expect(await startAgent(s.deps, START)).toBe(
      "herdr agent start failed after 7 tries over 60 s of waiting: described timed out, try 7. The host 1-minute load average cannot be read. Check the host load, then spawn again.",
    );
    expect(s.sleep.mock.calls).toEqual(BACKOFF_SLEEPS);
  });
});

describe("checkModel confirms the model the pane shows", () => {
  it("verifies the requested model's name on the first read, without waiting", async () => {
    vi.mocked(modelOnScreen).mockReturnValue({ status: "verified" });
    const s = fakeDeps([started]);
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
    const s = fakeDeps([started]);
    expect(await checkModel(s.deps, "image-trust-writer", MODEL)).toEqual({
      mismatch:
        'Session image-trust-writer runs "Haiku 5.5" but claude-opus-5-5 ("Opus 5.5") was requested.',
    });
    expect(s.sleep).not.toHaveBeenCalled();
  });

  it("reports unverified, never a pass, for a model with no display name, and reads nothing", async () => {
    vi.mocked(displayName).mockReturnValue(undefined);
    const s = fakeDeps([started]);
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
    const s = fakeDeps([started]);
    expect(await checkModel(s.deps, "image-trust-writer", MODEL)).toEqual({
      status: "verified",
    });
    expect(s.run).toHaveBeenCalledTimes(3);
    expect(s.sleep.mock.calls).toEqual([[500], [500]]);
  });

  it("gives up after five seconds, reporting unverified with the reason", async () => {
    const s = fakeDeps([started]);
    expect(await checkModel(s.deps, "image-trust-writer", MODEL)).toEqual({
      status: "unverified",
      reason:
        'The pane showed no model name, such as "Opus 5.5", within 5 seconds, so claude-opus-5-5 could not be confirmed.',
    });
    expect(s.run).toHaveBeenCalledTimes(11);
    expect(s.sleep.mock.calls).toEqual(Array.from({ length: 10 }, () => [500]));
  });

  it("checks an empty screen when the read itself fails, so a failed read is never a pass", async () => {
    const s = fakeDeps([failure(1)]);
    await checkModel(s.deps, "image-trust-writer", MODEL);
    expect(modelOnScreen).toHaveBeenCalledWith(MODEL, "");
    expect(
      vi.mocked(modelOnScreen).mock.calls.every(([, screen]) => screen === ""),
    ).toBe(true);
  });
});
