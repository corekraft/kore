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
  DIGEST,
  LOCKS,
  LOCK_FILES,
  NOW,
  RECORD_OPTIONS,
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

describe("platform rollout-record", () => {
  it("records one platform.rolled-out event with the environment, tag, lock digests and charts, and nothing else", async () => {
    const { ledger, write } = fakeLedger();
    vi.mocked(openLedger).mockResolvedValue({ ledger });
    const { context, out } = setup(RECORD_OPTIONS, LOCK_FILES);

    expect(await command("rollout-record").run(context)).toBe(0);

    expect(readRolloutLocks).toHaveBeenCalledWith({
      tag: "v1.4.0",
      chart: "CHART LOCK",
      image: "IMAGE LOCK",
    });
    expect(write).toHaveBeenCalledExactlyOnceWith({
      source: "claude",
      kind: "platform.rolled-out",
      occurredAt: NOW,
      environment: "vps",
      tag: "v1.4.0",
      chartLock: DIGEST,
      imageLock: DIGEST,
      charts: "CHARTS",
    });
    expect(out()).toBe(
      "Recorded platform.rolled-out: vps at v1.4.0, 1 charts, chart lock " +
        `${DIGEST}\n`,
    );
  });

  it("refuses a lock that is not the release's, writes nothing and never opens the ledger", async () => {
    vi.mocked(readRolloutLocks).mockImplementation(() => {
      throw new RolloutError(
        "The chart lock is not the release lock for v1.4.0",
      );
    });
    const { context, err } = setup(RECORD_OPTIONS, LOCK_FILES);

    expect(await command("rollout-record").run(context)).toBe(1);

    expect(err()).toBe("The chart lock is not the release lock for v1.4.0\n");
    expect(openLedger).not.toHaveBeenCalled();
  });

  it("prints the refusal as a JSON line before the text with --json", async () => {
    vi.mocked(readRolloutLocks).mockImplementation(() => {
      throw new RolloutError("refused");
    });
    const { context, err } = setup(RECORD_OPTIONS, LOCK_FILES, { json: true });

    await command("rollout-record").run(context);

    expect(err()).toBe(`${JSON.stringify({ error: "refused" })}\nrefused\n`);
  });
});

describe("platform rollout-record inputs and ledger", () => {
  it.each(["environment", "tag", "chart-lock", "image-lock"])(
    "refuses a run with no --%s, naming the usage, before reading a file",
    async (missing) => {
      const options = { ...RECORD_OPTIONS, [missing]: "  " };
      const { context, err, readFile } = setup(options, LOCK_FILES);

      expect(await command("rollout-record").run(context)).toBe(1);

      expect(err()).toContain(`Missing --${missing}`);
      expect(err()).toContain("harness platform rollout-record");
      expect(readFile).not.toHaveBeenCalled();
      expect(openLedger).not.toHaveBeenCalled();
    },
  );

  it("names a lock file it cannot read and writes nothing", async () => {
    const { context, err } = setup(RECORD_OPTIONS, {
      "/repo/platform-charts.lock.json": "CHART LOCK",
    });

    expect(await command("rollout-record").run(context)).toBe(1);

    expect(err()).toContain("platform-images.lock.json");
    expect(openLedger).not.toHaveBeenCalled();
  });

  it("reads an absolute lock path as given", async () => {
    vi.mocked(openLedger).mockResolvedValue({ ledger: fakeLedger().ledger });
    const { context, readFile } = setup(
      { ...RECORD_OPTIONS, "chart-lock": "/tmp/c.json" },
      { ...LOCK_FILES, "/tmp/c.json": "CHART LOCK" },
    );

    await command("rollout-record").run(context);

    expect(readFile).toHaveBeenCalledWith("/tmp/c.json");
  });

  it("reports a ledger that cannot be opened or that rejects the event", async () => {
    vi.mocked(openLedger).mockResolvedValue({ error: "no ledger" });
    const opened = setup(RECORD_OPTIONS, LOCK_FILES);
    expect(await command("rollout-record").run(opened.context)).toBe(1);
    expect(opened.err()).toBe("no ledger\n");

    const { ledger } = fakeLedger([], {
      ok: false,
      field: "tag",
      message: "bad tag",
    });
    vi.mocked(openLedger).mockResolvedValue({ ledger });
    const rejected = setup(RECORD_OPTIONS, LOCK_FILES);
    expect(await command("rollout-record").run(rejected.context)).toBe(1);
    expect(rejected.err()).toContain("bad tag");
  });

  it("prints the recorded rollout as one JSON object with --json", async () => {
    vi.mocked(openLedger).mockResolvedValue({ ledger: fakeLedger().ledger });
    const { context, out } = setup(RECORD_OPTIONS, LOCK_FILES, { json: true });

    await command("rollout-record").run(context);

    expect(JSON.parse(out())).toEqual({
      environment: "vps",
      tag: "v1.4.0",
      chartLock: DIGEST,
      imageLock: DIGEST,
      charts: 1,
    });
  });
});
