import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BranchLedger,
  BranchNotice,
  BranchStepNotifier,
  branchNoticeFlagOn,
  LiveProofs,
  Tick,
  liveProofsOn,
  leasedPass,
  tickFlagOn,
} from "../orchestrator/index.js";
import { hostLocksDirectory, mainRoot } from "../runtime/index.js";
import type { CommandContext } from "../runtime/index.js";
import { tickCommand } from "./orchestrate-tick.js";

vi.mock("./orchestrate-tick-install.js", () => ({ installTickJob: vi.fn() }));
vi.mock("./orchestrate-tick-loop.js", () => ({ runTickLoop: vi.fn() }));

vi.mock("../orchestrator/index.js", async () => ({
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
  hostLocksDirectory: vi.fn(),
  mainRoot: vi.fn(),
}));

function setup() {
  const out: string[] = [];
  const context = {
    json: false,
    options: {},
    deps: {
      runner: { run: vi.fn() },
      fs: { fs: true },
      root: () => Promise.resolve("/repo"),
      clock: { now: () => new Date("2026-11-17T10:00:00.000Z") },
      ids: { next: () => "token-1" },
      env: {},
      stdout: (t: string) => out.push(t),
      stderr: vi.fn(),
    } as unknown as CommandContext["deps"],
  } as CommandContext;
  return { context, out };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mainRoot).mockResolvedValue("/main");
  vi.mocked(hostLocksDirectory).mockReturnValue("/host/.kore/locks");
  vi.mocked(tickFlagOn).mockResolvedValue(true);
});

describe("orchestrate tick with the branch notice flag off", () => {
  it("reads no branch state and wires no branch notice, so a pass is unchanged", async () => {
    vi.mocked(branchNoticeFlagOn).mockResolvedValue(false);
    vi.mocked(leasedPass).mockResolvedValue({ status: "ran", steps: [] });
    const { context } = setup();

    expect(await tickCommand.run(context)).toBe(0);
    expect(branchNoticeFlagOn).toHaveBeenCalledWith(context.deps.fs, "/repo");
    expect(BranchNotice).not.toHaveBeenCalled();
    expect(BranchStepNotifier).not.toHaveBeenCalled();
    expect(BranchLedger).not.toHaveBeenCalled();
  });

  it("prints the notice a step carries on the line after the step", async () => {
    vi.mocked(branchNoticeFlagOn).mockResolvedValue(false);
    vi.mocked(leasedPass).mockResolvedValue({
      status: "ran",
      steps: [
        {
          idea: "0002",
          issue: 12,
          step: "waiting",
          notice:
            "Branch update notice sent to idea-0002-writer for PR #9 (conflict).",
        },
      ],
    });
    const { context, out } = setup();

    expect(await tickCommand.run(context)).toBe(0);
    expect(out.join("")).toBe(
      "Idea 0002: waiting.\nBranch update notice sent to idea-0002-writer for PR #9 (conflict).\n",
    );
  });
});

describe("orchestrate tick with the branch notice flag on", () => {
  it("wires the branch notice into the pass beside the attended-pane notifier", async () => {
    vi.mocked(branchNoticeFlagOn).mockResolvedValue(true);
    vi.mocked(leasedPass).mockResolvedValue({ status: "ran", steps: [] });
    const { context } = setup();

    expect(await tickCommand.run(context)).toBe(0);
    expect(BranchNotice).toHaveBeenCalledTimes(1);
    expect(BranchStepNotifier).toHaveBeenCalledTimes(1);
  });
});

describe("orchestrate tick with live proofs", () => {
  const withLiveProofs = vi.fn();
  beforeEach(() => {
    withLiveProofs.mockImplementation(function (this: unknown) {
      return this;
    });
    vi.mocked(Tick).mockImplementation(function () {
      return { withLiveProofs } as unknown as Tick;
    });
  });

  it("hands the tick no live-proof pass while live proofs are off", async () => {
    vi.mocked(liveProofsOn).mockResolvedValue(false);
    vi.mocked(leasedPass).mockResolvedValue({ status: "ran", steps: [] });
    const { context } = setup();

    expect(await tickCommand.run(context)).toBe(0);
    expect(LiveProofs).not.toHaveBeenCalled();
    expect(withLiveProofs).not.toHaveBeenCalled();
  });

  it("hands the tick a live-proof pass once tick-live-proofs and tick-ticket-queue are on", async () => {
    vi.mocked(liveProofsOn).mockResolvedValue(true);
    vi.mocked(leasedPass).mockResolvedValue({ status: "ran", steps: [] });
    const { context } = setup();

    expect(await tickCommand.run(context)).toBe(0);
    expect(LiveProofs).toHaveBeenCalledTimes(1);
    expect(withLiveProofs).toHaveBeenCalledWith(
      vi.mocked(LiveProofs).mock.instances[0],
    );
  });
});
