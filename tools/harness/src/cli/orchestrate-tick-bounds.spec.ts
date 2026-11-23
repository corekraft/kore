import { beforeEach, describe, expect, it, vi } from "vitest";
import { Ledger } from "../ledger/index.js";
import { BOUND_LABELS, Tick, runTicks } from "../orchestrator/index.js";
import { hostLocksDirectory, mainRoot, readPower } from "../runtime/index.js";
import type { CommandContext } from "../runtime/index.js";
import { hostLeaseRefusal, spawnLoadRefusal } from "../session/index.js";
import { runOnTicks } from "./orchestrate-tick.js";

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
  readPower: vi.fn(),
}));
vi.mock("../ledger/index.js", () => ({
  DEFAULT_LEDGER: ".kore/state/ledger.jsonl",
  Ledger: vi.fn(),
}));
vi.mock("../session/index.js", () => ({
  terminalsFor: vi.fn(),
  SessionRegistry: { open: vi.fn() },
  deliver: vi.fn(),
  hostLeaseRefusal: vi.fn(),
  signedMainSendsOn: vi.fn(),
  spawnLoadRefusal: vi.fn(),
}));

const NOW = new Date("2026-11-16T12:00:00.000Z");

/** Makes the ledger the tick builds, a constructor, record through the given function. */
function ledgerRecording(record: unknown): void {
  vi.mocked(Ledger).mockImplementation(function () {
    return { record } as unknown as Ledger;
  });
}

function setup() {
  const context = {
    json: false,
    options: {},
    deps: {
      runner: { run: vi.fn() },
      fs: { fs: true },
      root: () => Promise.resolve("/repo"),
      clock: { now: () => NOW, sleep: vi.fn() },
      ids: { next: () => "token-1" },
      stdout: vi.fn(),
      stderr: vi.fn(),
    } as unknown as CommandContext["deps"],
  } as CommandContext;
  return { context };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mainRoot).mockResolvedValue("/main");
  vi.mocked(hostLocksDirectory).mockReturnValue("/host/.kore/locks");
  vi.mocked(runTicks).mockResolvedValue({ status: "gave-up", rounds: 1 });
});

/** The gate the tick was built with, read from the Tick constructor's third argument. */
async function gateOf(): Promise<{
  read(): Promise<unknown>;
  record(issue: number, bound: string): Promise<void>;
}> {
  const { context } = setup();
  await runOnTicks(context.deps, "/repo", "0042", undefined);
  const gate = vi.mocked(Tick).mock.calls[0]?.[2];
  if (gate === undefined) {
    throw new Error("The tick was built without a gate.");
  }
  return gate as never;
}

describe("the tick's host bounds, read from the machine", () => {
  it("reads battery power and a load over the ceiling as a saver mode and a load hold", async () => {
    vi.mocked(readPower).mockResolvedValue("battery");
    vi.mocked(spawnLoadRefusal).mockReturnValue("load refused");
    vi.mocked(hostLeaseRefusal).mockResolvedValue(undefined);
    vi.mocked(runTicks).mockResolvedValue({ status: "gave-up", rounds: 1 });

    expect(await (await gateOf()).read()).toEqual({
      saver: true,
      hold: "load",
    });
  });

  it("reads AC power, a clear load and a free lease as no bound at all", async () => {
    vi.mocked(readPower).mockResolvedValue("ac");
    vi.mocked(spawnLoadRefusal).mockReturnValue(undefined);
    vi.mocked(hostLeaseRefusal).mockResolvedValue(undefined);
    vi.mocked(runTicks).mockResolvedValue({ status: "gave-up", rounds: 1 });

    expect(await (await gateOf()).read()).toEqual({ saver: false });
  });

  it("holds the starts while a live run holds the host lease, even on AC power with a clear load", async () => {
    vi.mocked(readPower).mockResolvedValue("ac");
    vi.mocked(spawnLoadRefusal).mockReturnValue(undefined);
    vi.mocked(hostLeaseRefusal).mockResolvedValue("a live run holds the lease");
    vi.mocked(runTicks).mockResolvedValue({ status: "gave-up", rounds: 1 });

    expect(await (await gateOf()).read()).toEqual({
      saver: false,
      hold: "live-run",
    });
  });

  it("writes each bound hit to the ledger as a tick.bound event on the idea's issue", async () => {
    const record = vi.fn().mockResolvedValue({ ok: true });
    ledgerRecording(record);
    vi.mocked(runTicks).mockResolvedValue({ status: "gave-up", rounds: 1 });

    await (await gateOf()).record(11, "load");

    expect(record).toHaveBeenCalledWith({
      source: "claude",
      kind: "tick.bound",
      occurredAt: NOW.toISOString(),
      idea: "#11",
      label: BOUND_LABELS.load,
    });
  });

  it("fails the pass, naming the ledger, when the ledger refuses a bound hit", async () => {
    ledgerRecording(vi.fn().mockResolvedValue({ ok: false, message: "bad" }));
    vi.mocked(runTicks).mockResolvedValue({ status: "gave-up", rounds: 1 });

    await expect((await gateOf()).record(11, "saver")).rejects.toThrow(
      /tick\.bound event was rejected: bad/,
    );
  });
});
