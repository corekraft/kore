import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HarnessCliError,
  Tick,
  TickNotifier,
  leasedPass,
  tickFlagOn,
} from "../orchestrator/index.js";
import { hostLocksDirectory, mainRoot } from "../runtime/index.js";
import type { CommandContext } from "../runtime/index.js";
import { hcSessionsOn } from "../session/index.js";
import { tickCommand } from "./orchestrate-tick.js";
import { hcAttended, hcReconcile } from "./orchestrate-tick-hc.js";

vi.mock("./orchestrate-tick-install.js", () => ({ installTickJob: vi.fn() }));
vi.mock("./orchestrate-tick-loop.js", () => ({ runTickLoop: vi.fn() }));
vi.mock("./orchestrate-tick-hc.js", () => ({
  hcAttended: vi.fn(),
  hcReconcile: vi.fn(),
}));
vi.mock("../session/index.js", async () => ({
  ...(await vi.importActual<object>("../session/index.js")),
  hcSessionsOn: vi.fn(),
}));
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
  reconcilingPass: (
    await vi.importActual<typeof import("../orchestrator/tick-reconcile.js")>(
      "../orchestrator/tick-reconcile.js",
    )
  ).reconcilingPass,
}));
vi.mock("../runtime/index.js", () => ({
  hostLocksDirectory: vi.fn(),
  mainRoot: vi.fn(),
}));

type Reconcile = Awaited<ReturnType<typeof hcReconcile>>;

function setup() {
  const out: string[] = [];
  const err: string[] = [];
  const context = {
    json: false,
    options: {},
    deps: {
      runner: { run: vi.fn() },
      fs: { fs: true },
      root: () => Promise.resolve("/repo"),
      clock: {
        now: () => new Date("2026-11-22T10:00:00.000Z"),
        sleep: vi.fn(),
      },
      ids: { next: () => "token-1" },
      stdout: (t: string) => out.push(t),
      stderr: (t: string) => err.push(t),
    } as unknown as CommandContext["deps"],
  } as CommandContext;
  return { context, out, err };
}

/** Makes the tick's pass run under the lease, so the wiring build returns is what runs; returns the pass spy. */
function wiredTick(order: string[]) {
  const pass = vi.fn(() => {
    order.push("pass");
    return Promise.resolve([]);
  });
  vi.mocked(Tick).mockImplementation(function tickFake() {
    return { pass, withLiveProofs: vi.fn() } as unknown as Tick;
  });
  vi.mocked(leasedPass).mockImplementation(async (_lease, tick) => {
    await tick.pass(undefined);
    return { status: "ran", steps: [] };
  });
  return pass;
}

function reconcileWith(reconcile: unknown): Reconcile {
  return { reconcile } as unknown as Reconcile;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mainRoot).mockResolvedValue("/main");
  vi.mocked(hostLocksDirectory).mockReturnValue("/host/.kore/locks");
  vi.mocked(tickFlagOn).mockResolvedValue(true);
});

describe("orchestrate tick with hc-sessions on", () => {
  beforeEach(() => {
    vi.mocked(hcSessionsOn).mockResolvedValue(true);
  });

  it("reconciles before the pass runs, so a lost session is recorded before any step", async () => {
    const order: string[] = [];
    const pass = wiredTick(order);
    vi.mocked(hcReconcile).mockResolvedValue(
      reconcileWith(
        vi.fn(() => {
          order.push("reconcile");
          return Promise.resolve([]);
        }),
      ),
    );
    const { context } = setup();

    expect(await tickCommand.run(context)).toBe(0);
    expect(order).toEqual(["reconcile", "pass"]);
    expect(pass).toHaveBeenCalledTimes(1);
    expect(hcReconcile).toHaveBeenCalledWith(context.deps, "/main");
  });

  it("sends the notices to the attended terminal, not to herdr", async () => {
    wiredTick([]);
    const attended = {
      attendedPane: vi.fn().mockResolvedValue("t9"),
      send: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(hcAttended).mockReturnValue(attended);
    vi.mocked(hcReconcile).mockResolvedValue(
      reconcileWith(vi.fn().mockResolvedValue([])),
    );
    const { context } = setup();

    await tickCommand.run(context);

    expect(hcAttended).toHaveBeenCalledWith(context.deps);
    const ports = vi.mocked(TickNotifier).mock.calls[0]?.[0];
    expect(ports?.attendedPane).toBe(attended.attendedPane);
    expect(ports?.send).toBe(attended.send);
  });

  it("runs no pass, and reports the cause, when the reconcile fails", async () => {
    const pass = wiredTick([]);
    vi.mocked(hcReconcile).mockResolvedValue(
      reconcileWith(
        vi.fn().mockRejectedValue(new HarnessCliError("hc is not running")),
      ),
    );
    const { context, err } = setup();

    expect(await tickCommand.run(context)).toBe(1);
    expect(pass).not.toHaveBeenCalled();
    expect(err.join("")).toBe("hc is not running\n");
  });
});

describe("orchestrate tick with hc-sessions off", () => {
  beforeEach(() => {
    vi.mocked(hcSessionsOn).mockResolvedValue(false);
  });

  it("builds no hc reconcile and no attended terminal, and keeps the herdr pass", async () => {
    const order: string[] = [];
    wiredTick(order);
    const { context } = setup();

    expect(await tickCommand.run(context)).toBe(0);
    expect(hcReconcile).not.toHaveBeenCalled();
    expect(hcAttended).not.toHaveBeenCalled();
    expect(order).toEqual(["pass"]);
    const ports = vi.mocked(TickNotifier).mock.calls[0]?.[0];
    expect(ports?.attendedPane).not.toBe(hcAttended);
    expect(ports?.send).toEqual(expect.any(Function));
  });
});
