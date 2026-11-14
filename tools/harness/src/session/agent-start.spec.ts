import { describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { startAgent } from "./agent-start.js";

vi.mock("./equalize.js", () => ({
  describeFailure: vi.fn(
    (result: { stderr: string }) => `described ${result.stderr}`,
  ),
}));
vi.mock("./models.js", () => ({
  displayName: vi.fn(),
  modelOnScreen: vi.fn(),
}));

const START = ["agent", "start", "image-trust-writer"];
const started = { code: 0, stdout: "", stderr: "" };
const failure = (n: number) => ({ code: 1, stdout: "", stderr: `try ${n}` });

/** Deps whose runner answers each start with the next result; the last one repeats. */
function scripted(results: readonly (typeof started)[]) {
  let call = 0;
  const run = vi.fn<CliDeps["runner"]["run"]>(() => {
    const result = results[Math.min(call, results.length - 1)] ?? started;
    call += 1;
    return Promise.resolve(result);
  });
  const sleep = vi.fn<CliDeps["clock"]["sleep"]>(() => Promise.resolve());
  // Only what startAgent touches; the rest of CliDeps is never read.
  const deps: Pick<CliDeps, "runner" | "clock"> = {
    runner: { run },
    clock: { now: () => new Date(0), sleep },
  };
  return { deps: deps as CliDeps, run, sleep };
}

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
