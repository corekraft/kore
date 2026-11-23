import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FileLeaseStore,
  HarnessCliError,
  TICK_LEASE_MAX_AGE_MS,
  Tick,
  TickCli,
  TickLease,
  leasedPass,
  runTicks,
  tickFlagOn,
} from "../orchestrator/index.js";
import { hostLocksDirectory, mainRoot } from "../runtime/index.js";
import type { CommandContext } from "../runtime/index.js";
import { runOnTicks, tickCommand } from "./orchestrate-tick.js";

vi.mock("./orchestrate-tick-install.js", () => ({ installTickJob: vi.fn() }));
vi.mock("../session/index.js", async () => ({
  ...(await vi.importActual<object>("../session/index.js")),
}));
vi.mock("./orchestrate-tick-loop.js", () => ({ runTickLoop: vi.fn() }));
vi.mock("./orchestrate-tick-idea.js", () => ({
  hasOutcomeFlags: vi.fn(),
  runIdea: vi.fn(),
}));

vi.mock("../orchestrator/index.js", async () => ({
  AttendedTerminal: vi.fn(),
  reconcilingPass: vi.fn(),
  TickReconcile: vi.fn(),
  unsettledOf: vi.fn(),
  ...(await vi.importActual<object>("../orchestrator/tick-bounds.js")),
  FileLeaseStore: vi.fn(),
  HarnessCliError: class extends Error {},
  PLANS_DIRECTORY: ".kore/state/tick-plans",
  TICK_LEASE_MAX_AGE_MS: 1800000,
  Tick: vi.fn(),
  NotifyLedger: vi.fn(),
  TICK_COMMAND: "orchestrate tick",
  TICK_ENV: { KORE_ROLE: "tick", KORE_AGENT: "orchestrator-tick" },
  TickCli: vi.fn(),
  TickLease: vi.fn(),
  TickNotifier: vi.fn(),
  BranchLedger: vi.fn(),
  BranchNotice: vi.fn(),
  BranchStepNotifier: vi.fn(),
  WaitingLedger: vi.fn(),
  WaitingStepNotifier: vi.fn(),
  WaitingTicketNotice: vi.fn(),
  branchNoticeFlagOn: vi.fn(),
  LiveProofs: vi.fn(),
  liveProofsOn: vi.fn(),
  leasedPass: vi.fn(),
  runTicks: vi.fn(),
  tickFlagOn: vi.fn(),
}));
vi.mock("../runtime/index.js", () => ({
  ProcessLineStream: vi.fn(),
  hostLocksDirectory: vi.fn(),
  mainRoot: vi.fn(),
}));

const NOW = new Date("2026-11-16T12:00:00.000Z");
const OUTCOME = {
  kind: "verification",
  source: "comparison",
  result: "confirmed",
  evidence: "PR #50",
  summary: "Merged.",
} as const;

function setup(options: Record<string, string | boolean> = {}, json = false) {
  const out: string[] = [];
  const err: string[] = [];
  const sleep = vi.fn().mockResolvedValue(undefined);
  const context = {
    json,
    options,
    deps: {
      runner: { run: vi.fn() },
      fs: { fs: true },
      root: () => Promise.resolve("/repo"),
      clock: { now: () => NOW, sleep },
      ids: { next: () => "token-1" },
      stdout: (t: string) => out.push(t),
      stderr: (t: string) => err.push(t),
    } as unknown as CommandContext["deps"],
  } as CommandContext;
  return { context, out, err, sleep };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mainRoot).mockResolvedValue("/main");
  vi.mocked(hostLocksDirectory).mockReturnValue("/host/.kore/locks");
});

describe("orchestrate tick with the flag off", () => {
  it("does nothing, and says the flag is off, so behaviour is unchanged", async () => {
    vi.mocked(tickFlagOn).mockResolvedValue(false);
    const { context, out } = setup();

    expect(await tickCommand.run(context)).toBe(0);
    expect(out.join("")).toBe(
      "The orchestrator-tick flag is off in the local overlay, so no idea was advanced.\n",
    );
    expect(TickCli).not.toHaveBeenCalled();
    expect(TickLease).not.toHaveBeenCalled();
    expect(leasedPass).not.toHaveBeenCalled();
  });
});

describe("orchestrate tick with the flag on", () => {
  beforeEach(() => {
    vi.mocked(tickFlagOn).mockResolvedValue(true);
  });

  it("builds the lease and the session registry on the machine, and runs one leased pass", async () => {
    vi.mocked(leasedPass).mockResolvedValue({
      status: "ran",
      steps: [{ idea: "0001", issue: 11, step: "spawn-writer" }],
    });
    const { context, out } = setup();

    expect(await tickCommand.run(context)).toBe(0);
    expect(FileLeaseStore).toHaveBeenCalledWith(
      context.deps.fs,
      "/host/.kore/locks/orchestrate-tick.lock",
    );
    expect(TickCli).toHaveBeenCalledWith(
      context.deps.runner,
      "/repo",
      context.deps.fs,
      {
        sessions: "/main/.kore/state/sessions",
        plans: "/main/.kore/state/tick-plans",
        checkout: "/main",
      },
    );
    expect(TickLease).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function),
      "token-1",
      expect.objectContaining({ pid: process.pid }),
      TICK_LEASE_MAX_AGE_MS,
    );
    expect(Tick).toHaveBeenCalledTimes(1);
    expect(vi.mocked(leasedPass).mock.calls[0]?.[2]).toBeUndefined();
    expect(out.join("")).toBe("Idea 0001: spawn-writer.\n");
  });

  it("scopes the pass to the one idea named, and prints the steps as JSON", async () => {
    vi.mocked(leasedPass).mockResolvedValue({
      status: "ran",
      steps: [{ idea: "0002", issue: 12, step: "waiting" }],
    });
    const { context, out } = setup({ idea: "0002" }, true);

    expect(await tickCommand.run(context)).toBe(0);
    expect(vi.mocked(leasedPass).mock.calls[0]?.[2]).toBe("0002");
    expect(out.join("")).toBe(
      '{"steps":[{"idea":"0002","issue":12,"step":"waiting"}]}\n',
    );
  });
});

describe("orchestrate tick results", () => {
  beforeEach(() => {
    vi.mocked(tickFlagOn).mockResolvedValue(true);
  });

  it("reports an idle queue", async () => {
    vi.mocked(leasedPass).mockResolvedValue({ status: "ran", steps: [] });
    const { context, out } = setup();

    expect(await tickCommand.run(context)).toBe(0);
    expect(out.join("")).toBe("No approved idea is in flight.\n");
  });

  it("skips the pass, naming the holder, while another tick holds the lease", async () => {
    vi.mocked(leasedPass).mockResolvedValue({
      status: "held",
      holder: {
        token: "other",
        pid: 99,
        host: "this-machine",
        acquiredAt: "2026-11-16T11:50:00.000Z",
      },
    });
    const { context, out } = setup();

    expect(await tickCommand.run(context)).toBe(0);
    expect(out.join("")).toBe(
      "Another tick holds the lease (pid 99 on this-machine, since 2026-11-16T11:50:00.000Z); this pass advanced nothing.\n",
    );
  });

  it("says when it recovered a lease by age", async () => {
    vi.mocked(leasedPass).mockResolvedValue({
      status: "ran",
      steps: [],
      recovered: {
        token: "old",
        pid: 5,
        host: "this-machine",
        acquiredAt: "2026-11-16T09:00:00.000Z",
      },
    });
    const { context, out } = setup();

    await tickCommand.run(context);

    expect(out.join("")).toBe(
      "Recovered a tick lease held since 2026-11-16T09:00:00.000Z by pid 5.\nNo approved idea is in flight.\n",
    );
  });

  it("reports a failing harness tool as an actionable error and exits 1", async () => {
    vi.mocked(leasedPass).mockRejectedValue(
      new HarnessCliError("`gh pr view 7` failed: no. Fix that, then rerun."),
    );
    const { context, err } = setup();

    expect(await tickCommand.run(context)).toBe(1);
    expect(err.join("")).toBe(
      "`gh pr view 7` failed: no. Fix that, then rerun.\n",
    );
  });
});

describe("runOnTicks", () => {
  it("runs passes over the one idea, with the given outcome, sleeping through the clock", async () => {
    vi.mocked(runTicks).mockResolvedValue({
      status: "outcome-recorded",
      rounds: 4,
    });
    const { context, sleep } = setup();

    expect(await runOnTicks(context.deps, "/repo", "0042", OUTCOME)).toEqual({
      status: "outcome-recorded",
      rounds: 4,
    });
    expect(Tick).toHaveBeenCalledWith(
      expect.anything(),
      new Map([["0042", OUTCOME]]),
      expect.anything(),
      undefined,
      expect.anything(),
    );
    const [, idea, wait] = vi.mocked(runTicks).mock.calls[0] ?? [];
    expect(idea).toBe("0042");
    await wait?.(5);
    expect(sleep).toHaveBeenCalledWith(5);
  });

  it("reads a pass that finds the lease held as waiting, so the run sleeps and tries again", async () => {
    vi.mocked(runTicks).mockResolvedValue({ status: "gave-up", rounds: 1 });
    const { context } = setup();
    await runOnTicks(context.deps, "/repo", "0042", undefined);
    const tick = vi.mocked(runTicks).mock.calls[0]?.[0];

    vi.mocked(leasedPass).mockResolvedValue({ status: "held" });
    expect(await tick?.pass("0042")).toEqual([
      { idea: "0042", step: "waiting" },
    ]);
    vi.mocked(leasedPass).mockResolvedValue({
      status: "ran",
      steps: [{ idea: "0042", issue: 11, step: "review" }],
    });
    expect(await tick?.pass("0042")).toEqual([
      { idea: "0042", issue: 11, step: "review" },
    ]);
    expect(Tick).toHaveBeenCalledWith(
      expect.anything(),
      new Map(),
      expect.anything(),
      undefined,
      expect.anything(),
    );
  });
});

describe("the tick's printed steps", () => {
  it("says which bound held an idea's start", async () => {
    vi.mocked(tickFlagOn).mockResolvedValue(true);
    vi.mocked(leasedPass).mockResolvedValue({
      status: "ran",
      steps: [{ idea: "0002", issue: 12, step: "held", bound: "saver" }],
    });
    const { context, out } = setup();

    expect(await tickCommand.run(context)).toBe(0);
    expect(out.join("")).toBe("Idea 0002: held by saver.\n");
  });
});
