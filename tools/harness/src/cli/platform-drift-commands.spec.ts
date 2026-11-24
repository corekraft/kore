// Docs: docs/decisions/0150-platform-releases-reach-vps-by-a-recorded-rollout-and-roll-back-by-revert.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatCharts, parseCharts } from "../ledger/index.js";
import {
  compareRollout,
  parseChartRows,
  readRolloutLocks,
  RolloutError,
} from "../rollout/index.js";
import { fakeLedger } from "./command-support.js";
import { openLedger } from "./ledger-commands.js";
import {
  CLEAN,
  EVENT,
  LOCKS,
  NOW,
  command,
  setup,
} from "./platform-commands-support.js";

vi.mock("./ledger-commands.js");
vi.mock("../ledger/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ledger/index.js")>()),
  formatCharts: vi.fn(),
  parseCharts: vi.fn(),
}));
vi.mock("../rollout/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../rollout/index.js")>()),
  readRolloutLocks: vi.fn(),
  parseChartRows: vi.fn(),
  compareRollout: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(readRolloutLocks).mockReturnValue(LOCKS);
  vi.mocked(formatCharts).mockReturnValue("CHARTS");
  vi.mocked(parseCharts).mockReturnValue(LOCKS.charts);
  vi.mocked(parseChartRows).mockReturnValue([]);
  vi.mocked(compareRollout).mockReturnValue(CLEAN);
});

describe("platform rollout-drift", () => {
  it("says plainly that nothing is recorded, names the command that records it, and fails", async () => {
    vi.mocked(openLedger).mockResolvedValue({ ledger: fakeLedger().ledger });
    const { context, err, out } = setup(
      { environment: "vps" },
      {},
      { stdin: "[]" },
    );

    expect(await command("rollout-drift").run(context)).toBe(1);

    expect(err()).toBe(
      "No platform rollout is recorded for vps, so there is nothing to compare; run `harness platform rollout-record --environment vps` after `kore platform up`, then rerun this check.\n",
    );
    expect(out()).toBe("");
    expect(compareRollout).not.toHaveBeenCalled();
  });

  it("ignores a rollout recorded for another environment", async () => {
    const { ledger } = fakeLedger([{ ...EVENT, environment: "local" }]);
    vi.mocked(openLedger).mockResolvedValue({ ledger });
    const { context, err } = setup({ environment: "vps" }, {}, { stdin: "[]" });

    expect(await command("rollout-drift").run(context)).toBe(1);

    expect(err()).toContain("No platform rollout is recorded for vps");
  });

  it("compares the newest rollout recorded for the environment with the status on stdin", async () => {
    const { ledger } = fakeLedger([
      { ...EVENT, tag: "v1.3.0", charts: "OLD" },
      { ...EVENT, tag: "v1.4.0", charts: "NEW" },
    ]);
    vi.mocked(openLedger).mockResolvedValue({ ledger });
    const { context, out } = setup(
      { environment: "vps" },
      {},
      { stdin: "STATUS" },
    );

    expect(await command("rollout-drift").run(context)).toBe(0);

    expect(parseCharts).toHaveBeenCalledWith("NEW");
    expect(parseChartRows).toHaveBeenCalledWith("STATUS");
    expect(out()).toBe(
      "No drift: the 1 compared chart matches the rollout of v1.4.0 recorded at 2026-11-24T10:00:00.000Z.\n",
    );
  });
});

describe("platform rollout-drift output", () => {
  it("reads the status from --status when given, relative to the root", async () => {
    vi.mocked(openLedger).mockResolvedValue({
      ledger: fakeLedger([EVENT]).ledger,
    });
    const { context, readFile } = setup(
      { environment: "vps", status: "status.json" },
      { "/repo/status.json": "FILE STATUS" },
    );

    await command("rollout-drift").run(context);

    expect(readFile).toHaveBeenCalledWith("/repo/status.json");
    expect(parseChartRows).toHaveBeenCalledWith("FILE STATUS");
  });
});

describe("platform rollout-drift failures", () => {
  it("names each difference on stderr and fails, listing what was not compared", async () => {
    vi.mocked(openLedger).mockResolvedValue({
      ledger: fakeLedger([EVENT]).ledger,
    });
    vi.mocked(compareRollout).mockReturnValue({
      compared: 2,
      differences: ["cert-manager: recorded version v1, installed v2"],
      notCompared: ["tls: no Helm release row"],
    });
    const { context, err, out } = setup(
      { environment: "vps" },
      {},
      { stdin: "[]" },
    );

    expect(await command("rollout-drift").run(context)).toBe(1);

    expect(err()).toBe(
      "Drift from the rollout of v1.4.0 recorded at 2026-11-24T10:00:00.000Z:\n" +
        "  cert-manager: recorded version v1, installed v2\n" +
        "Not compared:\n  tls: no Helm release row\n",
    );
    expect(out()).toBe("");
  });

  it("does not report no drift when nothing could be compared", async () => {
    vi.mocked(openLedger).mockResolvedValue({
      ledger: fakeLedger([EVENT]).ledger,
    });
    vi.mocked(compareRollout).mockReturnValue({
      compared: 0,
      differences: [],
      notCompared: ["cert-manager: no Helm release row"],
    });
    const { context, err, out } = setup(
      { environment: "vps" },
      {},
      { stdin: "[]" },
    );

    expect(await command("rollout-drift").run(context)).toBe(1);

    expect(err()).toContain("Nothing could be compared");
    expect(err()).toContain("cert-manager: no Helm release row");
    expect(out()).toBe("");
  });
});

describe("platform rollout-drift JSON and usage", () => {
  it("prints the comparison as one JSON object with --json, on stdout when clean", async () => {
    vi.mocked(openLedger).mockResolvedValue({
      ledger: fakeLedger([EVENT]).ledger,
    });
    const { context, out } = setup(
      { environment: "vps" },
      {},
      { json: true, stdin: "[]" },
    );

    expect(await command("rollout-drift").run(context)).toBe(0);

    expect(JSON.parse(out())).toEqual({
      environment: "vps",
      tag: "v1.4.0",
      recordedAt: NOW,
      ...CLEAN,
    });
  });

  it("refuses a run with no --environment, and status text that is not the status", async () => {
    const missing = setup({});
    expect(await command("rollout-drift").run(missing.context)).toBe(1);
    expect(missing.err()).toContain("Missing --environment");

    vi.mocked(openLedger).mockResolvedValue({
      ledger: fakeLedger([EVENT]).ledger,
    });
    vi.mocked(parseChartRows).mockImplementation(() => {
      throw new RolloutError("not the status");
    });
    const bad = setup({ environment: "vps" }, {}, { stdin: "oops" });
    expect(await command("rollout-drift").run(bad.context)).toBe(1);
    expect(bad.err()).toBe("not the status\n");
  });
});
