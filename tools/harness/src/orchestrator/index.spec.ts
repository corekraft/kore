import { describe, expect, it, vi } from "vitest";
import * as barrel from "./index.js";
import { IdeaRun } from "./idea-run.js";

vi.mock("./idea-run.js", () => ({ IdeaRun: vi.fn(), MAX_ROUNDS: 6 }));
vi.mock("./harness-cli.js", () => ({
  HarnessCli: vi.fn(),
  HarnessCliError: vi.fn(),
}));

vi.mock("./retro-launch.js", () => ({
  RETRO_EFFORT: "e",
  RETRO_FLAG: "f",
  RETRO_MODEL: "m",
  RETRO_ROLE: "r",
  RetroLaunch: vi.fn(),
}));
vi.mock("./retro-filing.js", () => ({ RetroFiling: vi.fn() }));
vi.mock("./retro-filing-cli.js", () => ({ RetroFilingCli: vi.fn() }));
vi.mock("./retro-flag.js", () => ({ retroFlagOn: vi.fn() }));
vi.mock("./tick.js", () => ({ Tick: vi.fn() }));
vi.mock("./tick-cli.js", () => ({ TickCli: vi.fn() }));
vi.mock("./tick-flag.js", () => ({ TICK_FLAG: "f", tickFlagOn: vi.fn() }));
vi.mock("./tick-lease-store.js", () => ({ FileLeaseStore: vi.fn() }));
vi.mock("./tick-lease.js", () => ({
  TICK_LEASE_MAX_AGE_MS: 1,
  TickLease: vi.fn(),
}));
vi.mock("./tick-leased.js", () => ({ leasedPass: vi.fn() }));
vi.mock("./tick-heartbeat.js", () => ({
  TICK_HEARTBEAT_GAP_MS: 1,
  TICK_STARTED: "tick.started",
  TICK_STOPPED: "tick.stopped",
  tickHeartbeat: vi.fn(),
}));
vi.mock("./tick-loop.js", () => ({
  TICK_LOOP_INTERVAL_MS: 1,
  TickLoop: vi.fn(),
}));
vi.mock("./tick-restart-job.js", () => ({
  TICK_JOB_LABEL: "label",
  restartJobPath: vi.fn(),
  restartJobPlist: vi.fn(),
}));
vi.mock("./tick-run.js", () => ({
  MAX_TICK_PASSES: 1,
  TICK_POLL_MS: 1,
  runTicks: vi.fn(),
}));

describe("the orchestrator barrel", () => {
  it("exposes the domain's public names, and no file's internals", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "BOUND_LABELS",
      "FileLeaseStore",
      "HarnessCli",
      "HarnessCliError",
      "IdeaRun",
      "MAX_ROUNDS",
      "MAX_TICK_PASSES",
      "RETRO_EFFORT",
      "RETRO_FLAG",
      "RETRO_MODEL",
      "RETRO_ROLE",
      "RetroFiling",
      "RetroFilingCli",
      "RetroLaunch",
      "TICK_FLAG",
      "TICK_HEARTBEAT_GAP_MS",
      "TICK_JOB_LABEL",
      "TICK_LEASE_MAX_AGE_MS",
      "TICK_LOOP_INTERVAL_MS",
      "TICK_POLL_MS",
      "TICK_STARTED",
      "TICK_STOPPED",
      "Tick",
      "TickBounds",
      "TickCli",
      "TickLease",
      "TickLoop",
      "leasedPass",
      "restartJobPath",
      "restartJobPlist",
      "retroFlagOn",
      "runTicks",
      "tickFlagOn",
      "tickHeartbeat",
    ]);
  });

  it("re-exports the unit's own class, not a copy", () => {
    expect(barrel.IdeaRun).toBe(IdeaRun);
  });
});
