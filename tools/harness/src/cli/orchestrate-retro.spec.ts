import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { flowMetricNames } from "../flow/index.js";
import {
  RetroFiling,
  RetroFilingCli,
  RetroLaunch,
  retroFlagOn,
  type FilingPorts,
  type HarnessCli,
  type RetroPorts,
} from "../orchestrator/index.js";
import type { CliDeps } from "../runtime/index.js";
import { briefBackend } from "../session/index.js";
import { retroHook } from "./orchestrate-retro.js";

vi.mock("node:crypto", () => ({ createHash: vi.fn() }));
vi.mock("../flow/index.js", () => ({ flowMetricNames: vi.fn() }));
vi.mock("../session/index.js", () => ({ briefBackend: vi.fn() }));
vi.mock("../orchestrator/index.js", () => ({
  RETRO_MODEL: "claude-sonnet-5-5",
  RETRO_EFFORT: "high",
  RetroLaunch: vi.fn(),
  RetroFiling: vi.fn(),
  RetroFilingCli: vi.fn(),
  retroFlagOn: vi.fn(),
}));

const ROOT = "root-dir";
const launchRun = vi.fn();
const filingRun = vi.fn();
const harness = {
  retroDue: vi.fn(),
  retroRecord: vi.fn(),
  spawnRetro: vi.fn(),
  collect: vi.fn(),
  close: vi.fn(),
};
const out: string[] = [];
const err: string[] = [];
const deps = {
  runner: { run: vi.fn() },
  fs: { fs: true },
  clock: { now: () => new Date("2026-11-15T10:00:00.000Z") },
  stdout: (t: string) => out.push(t),
  stderr: (t: string) => err.push(t),
} as unknown as CliDeps;

const hook = () => retroHook(deps, ROOT, harness as unknown as HarnessCli);

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  err.length = 0;
  vi.mocked(RetroLaunch).mockImplementation(function () {
    return { run: launchRun } as unknown as RetroLaunch;
  });
  vi.mocked(RetroFiling).mockImplementation(function () {
    return { run: filingRun } as unknown as RetroFiling;
  });
  launchRun.mockResolvedValue({ status: "not-due" });
});

describe("retroHook launch ports", () => {
  it("gives the retro pane the brief backend the hc-sessions flag names", async () => {
    vi.mocked(briefBackend).mockResolvedValue("hc");
    hook();
    const ports = vi.mocked(RetroLaunch).mock.calls[0]?.[0] as RetroPorts;

    expect(await ports.backend()).toBe("hc");
    expect(briefBackend).toHaveBeenCalledWith(deps);
  });

  it("builds the ports from the harness tools and the local overlay flag", async () => {
    await hook()();
    const ports = vi.mocked(RetroLaunch).mock.calls[0]?.[0] as RetroPorts;
    vi.mocked(retroFlagOn).mockResolvedValue(true);
    harness.retroDue.mockResolvedValue({ due: false });

    expect(await ports.flagOn()).toBe(true);
    expect(retroFlagOn).toHaveBeenCalledWith(deps.fs, ROOT);
    expect(await ports.due()).toEqual({ due: false });
  });

  it("stays silent and collects nothing when no retro was started", async () => {
    await hook()();

    expect(err.join("")).toBe("");
    expect(harness.collect).not.toHaveBeenCalled();
    expect(filingRun).not.toHaveBeenCalled();
  });
});

describe("retroHook after a retro pane started", () => {
  beforeEach(() => {
    launchRun.mockResolvedValue({
      status: "launched",
      reason: "count",
      name: "retro-20261115-0930",
    });
    harness.collect.mockResolvedValue({ outcome: "done", text: "pane text" });
  });

  it("collects the pane, closes it, and files its proposals under the pane's name", async () => {
    filingRun.mockResolvedValue({
      status: "filed",
      filed: 2,
      existing: 0,
      dropped: 1,
    });

    await hook()();

    expect(harness.collect).toHaveBeenCalledWith("retro-20261115-0930");
    expect(harness.close).toHaveBeenCalledWith("retro-20261115-0930");
    expect(filingRun).toHaveBeenCalledWith("retro-20261115-0930", "pane text");
    expect(err.join("")).toBe(
      "Started retro pane retro-20261115-0930 (count) on claude-sonnet-5-5 at high effort.\nRetro retro-20261115-0930 filed 2 ideas (0 already filed, 1 dropped by the cap).\n",
    );
  });

  it("says why nothing was filed when the batch was refused, and does not fail the run", async () => {
    filingRun.mockResolvedValue({ status: "refused", error: "Proposal 2 bad" });

    await hook()();

    expect(err.join("")).toContain(
      "Retro retro-20261115-0930 filed nothing: Proposal 2 bad",
    );
  });

  it("files nothing when the pane ended blocked", async () => {
    harness.collect.mockResolvedValue({ outcome: "blocked", text: "t" });

    await hook()();

    expect(filingRun).not.toHaveBeenCalled();
    expect(err.join("")).toContain("ended blocked; nothing was filed");
  });
});

describe("retroHook filing ports", () => {
  it("wires the flag, the flow report metrics, the hash and the harness tools", async () => {
    launchRun.mockResolvedValue({
      status: "launched",
      reason: "count",
      name: "r",
    });
    harness.collect.mockResolvedValue({ outcome: "done", text: "" });
    filingRun.mockResolvedValue({ status: "flag-off" });
    vi.mocked(flowMetricNames).mockReturnValue(["friction.total"]);
    vi.mocked(retroFlagOn).mockResolvedValue(true);
    const digest = vi.fn().mockReturnValue("abcdef0123456789");
    vi.mocked(createHash).mockReturnValue({
      update: () => ({ digest }),
    } as never);

    await hook()();
    const ports = vi.mocked(RetroFiling).mock.calls[0]?.[0] as FilingPorts;

    expect(await ports.flagOn()).toBe(true);
    expect(await ports.metricNames()).toEqual(["friction.total"]);
    expect(ports.hash("x")).toBe("abcdef01");
    expect(RetroFilingCli).toHaveBeenCalledWith(
      deps.runner,
      ROOT,
      expect.any(Function),
    );
    const now = vi.mocked(RetroFilingCli).mock.calls[0]?.[2];
    expect(now?.()).toBe("2026-11-15T10:00:00.000Z");
  });
});
