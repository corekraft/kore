import { beforeEach, describe, expect, it, vi } from "vitest";
import { Ledger } from "../ledger/index.js";
import {
  TickLoop,
  TickSelfUpdate,
  tickFlagOn,
  tickSelfUpdateOn,
  type LoopPorts,
  type LoopResult,
} from "../orchestrator/index.js";
import { mainRoot } from "../runtime/index.js";
import type { CliDeps } from "../runtime/index.js";
import { runTickLoop } from "./orchestrate-tick-loop.js";

vi.mock("../ledger/index.js", () => ({
  DEFAULT_LEDGER: ".kore/state/ledger.jsonl",
  Ledger: vi.fn(),
}));
vi.mock("../orchestrator/index.js", () => ({
  HarnessCliError: class extends Error {},
  TICK_STARTED: "tick.started",
  TICK_STOPPED: "tick.stopped",
  TickLoop: vi.fn(),
  TickSelfUpdate: vi.fn(),
  tickFlagOn: vi.fn(),
  tickSelfUpdateOn: vi.fn(),
}));
vi.mock("../runtime/index.js", () => ({
  mainRoot: vi.fn(),
}));

const NOW = new Date("2026-11-16T12:00:00.000Z");
const ROOT = "/repo";

/** The ports the adapter handed the loop, captured so each one can be driven. */
function capturedPorts(): LoopPorts {
  const [ports] = vi.mocked(TickLoop).mock.calls[0] as [LoopPorts];
  return ports;
}

function setup(written = { ok: true as boolean, message: "" }) {
  const out: string[] = [];
  const err: string[] = [];
  const runs: Array<{ command: string; args: string[]; cwd?: string }> = [];
  const record = vi.fn().mockResolvedValue(written);
  const deps = {
    runner: {
      run: vi.fn(
        async (command: string, args: string[], options?: { cwd?: string }) => {
          runs.push({
            command,
            args,
            ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
          });
          return { stdout: "Idea 1: waiting.\n", stderr: "", code: 0 };
        },
      ),
    },
    fs: { fs: true },
    root: () => Promise.resolve(ROOT),
    clock: { now: () => NOW, sleep: vi.fn().mockResolvedValue(undefined) },
    ids: { next: () => "id-1" },
    stdout: (t: string) => out.push(t),
    stderr: (t: string) => err.push(t),
  } as unknown as CliDeps;
  vi.mocked(Ledger).mockImplementation(function () {
    return { record } as unknown as Ledger;
  });
  return { deps, out, err, runs, record };
}

/** Makes the loop the adapter builds end at once with this result, without running any pass. */
function loopEndingWith(result: LoopResult): void {
  vi.mocked(TickLoop).mockImplementation(function () {
    return { run: vi.fn().mockResolvedValue(result) } as unknown as TickLoop;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mainRoot).mockResolvedValue("/main");
  loopEndingWith({ status: "limit", passes: 1 });
});

describe("orchestrate tick --loop", () => {
  it("writes its heartbeat and its stop to the main checkout's ledger, stamped with the clock", async () => {
    vi.mocked(tickFlagOn).mockResolvedValue(true);
    const { deps, record } = setup();

    await runTickLoop(deps, ROOT, undefined);
    await capturedPorts().heartbeat();
    await capturedPorts().stopped();

    expect(record).toHaveBeenNthCalledWith(1, {
      source: "claude",
      kind: "tick.started",
      occurredAt: NOW.toISOString(),
    });
    expect(record).toHaveBeenNthCalledWith(2, {
      source: "claude",
      kind: "tick.stopped",
      occurredAt: NOW.toISOString(),
    });
  });

  it("runs each pass as a child harness process from this checkout, never in the loop's own process", async () => {
    vi.mocked(tickFlagOn).mockResolvedValue(true);
    const { deps, runs } = setup();

    await runTickLoop(deps, ROOT, undefined);
    await capturedPorts().pass();

    expect(runs).toEqual([
      {
        command: process.execPath,
        args: ["/repo/skills/bin/harness.mjs", "orchestrate", "tick"],
        cwd: ROOT,
      },
    ]);
  });

  it("scopes each child pass to one idea when the loop is given --idea", async () => {
    vi.mocked(tickFlagOn).mockResolvedValue(true);
    const { deps, runs } = setup();

    await runTickLoop(deps, ROOT, "7");
    await capturedPorts().pass();

    expect(runs[0]?.args).toEqual([
      "/repo/skills/bin/harness.mjs",
      "orchestrate",
      "tick",
      "--idea",
      "7",
    ]);
  });

  it("shows a failed pass's output and says the loop goes on, so a throwing tick is visible", async () => {
    vi.mocked(tickFlagOn).mockResolvedValue(true);
    const { deps, err, out } = setup();

    await runTickLoop(deps, ROOT, undefined);
    capturedPorts().report({
      stdout: "",
      stderr: "TypeError: boom\n",
      code: 1,
    });

    expect(out.join("")).toBe("");
    expect(err.join("")).toBe(
      "TypeError: boom\nA pass ended with exit 1; the loop runs the next pass.\n",
    );
  });

  it("names the event it could not write, so a rejected ledger is fixed rather than silent", async () => {
    vi.mocked(tickFlagOn).mockResolvedValue(true);
    const { deps } = setup({ ok: false, message: "label too long" });

    await runTickLoop(deps, ROOT, undefined);
    await expect(capturedPorts().heartbeat()).rejects.toThrow(
      "The tick.started event was rejected: label too long. Fix the ledger, then rerun orchestrate tick --loop.",
    );
  });
});

describe("orchestrate tick --loop and the flag", () => {
  it("says the flag is off and starts nothing when the flag is off from the start", async () => {
    vi.mocked(tickFlagOn).mockResolvedValue(false);
    loopEndingWith({ status: "flag-off", passes: 0 });
    const { deps, out, runs } = setup();

    expect(await runTickLoop(deps, ROOT, undefined)).toBe(0);
    expect(out.join("")).toBe(
      "The orchestrator-tick flag is off in the local overlay, so no idea was advanced.\n",
    );
    expect(runs).toEqual([]);
  });

  it("says how many passes ran when the flag is turned off mid-loop, so the stop is explained", async () => {
    vi.mocked(tickFlagOn).mockResolvedValue(true);
    loopEndingWith({ status: "flag-off", passes: 3 });
    const { deps, out } = setup();

    expect(await runTickLoop(deps, ROOT, undefined)).toBe(0);
    expect(out.join("")).toBe(
      "The orchestrator-tick flag turned off after 3 passes, so the loop stopped.\n",
    );
  });
});

describe("orchestrate tick --loop self-update step", () => {
  it("runs the self-update before each pass only while the tick-self-update flag is on", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    vi.mocked(TickSelfUpdate).mockImplementation(function () {
      return { run } as unknown as TickSelfUpdate;
    });
    vi.mocked(tickSelfUpdateOn).mockResolvedValue(true);
    const { deps } = setup();

    await runTickLoop(deps, ROOT, undefined);
    await capturedPorts().update?.();
    expect(run).toHaveBeenCalledTimes(1);

    vi.mocked(tickSelfUpdateOn).mockResolvedValue(false);
    await capturedPorts().update?.();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reports a thrown update on stderr and says the pass still runs", async () => {
    const { deps, err } = setup();

    await runTickLoop(deps, ROOT, undefined);
    capturedPorts().updateFailed(new Error("git exploded"));

    expect(err.join("")).toBe(
      "The self-update step failed: git exploded\nThe tick keeps the bundle it has and runs the pass; fix the checkout or ledger it names, then the next pass retries the update.\n",
    );
  });
});
