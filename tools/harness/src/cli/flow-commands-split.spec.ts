import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildReport,
  DEFAULT_COST,
  MIN_COMPLETED_IDEAS,
} from "../flow/index.js";
import { isTimestamp } from "../ledger/index.js";
import type { CommandContext } from "../runtime/index.js";
import { flowCommands } from "./flow-commands.js";
import { openLedger } from "./ledger-commands.js";
import { sendBackTierReportLines } from "./flow-lines-send-back-split.js";
import {
  contextOf,
  emptyReport,
  ledgerOf,
  NOW,
} from "./flow-commands-support.js";

vi.mock("node:path");
vi.mock("../flow/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flow/index.js")>()),
  buildReport: vi.fn(),
  parseHarnessConfig: vi.fn(),
}));
vi.mock("../ledger/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ledger/index.js")>()),
  isTimestamp: vi.fn(),
}));
vi.mock("./ledger-commands.js");
vi.mock("./flow-lines-send-back-split.js");

const run = (context: CommandContext) => flowCommands.report?.run(context);

beforeEach(() => {
  vi.mocked(sendBackTierReportLines).mockReturnValue([]);
});

describe("flow report: the split date (#1047)", () => {
  it("passes --split-at through to the report beside the date bounds", async () => {
    vi.mocked(isTimestamp).mockReturnValue(true);
    const { context } = contextOf({
      since: "2026-11-01T00:00:00Z",
      until: "2026-11-30T00:00:00Z",
      "split-at": "2026-11-16T00:00:00Z",
    });
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(emptyReport());

    await run(context);

    expect(buildReport).toHaveBeenCalledWith([], {
      asOf: NOW,
      minCompletedIdeas: MIN_COMPLETED_IDEAS,
      since: new Date("2026-11-01T00:00:00Z"),
      until: new Date("2026-11-30T00:00:00Z"),
      splitAt: new Date("2026-11-16T00:00:00Z"),
      cost: DEFAULT_COST,
    });
  });

  it("refuses a --split-at outside the range, naming the fix, and reads nothing", async () => {
    vi.mocked(isTimestamp).mockReturnValue(true);
    const { context, stderr } = contextOf({
      since: "2026-11-10T00:00:00Z",
      "split-at": "2026-11-01T00:00:00Z",
    });

    expect(await run(context)).toBe(2);
    expect(stderr).toHaveBeenCalledWith(
      "Invalid --split-at 2026-11-01T00:00:00.000Z: it is before --since 2026-11-10T00:00:00.000Z. Use a date inside the range, or move --since earlier.\n",
    );
    expect(openLedger).not.toHaveBeenCalled();
  });

  it("prints the tier lines the split module gives, with the report's own tier figures and split", async () => {
    const empty = emptyReport();
    const split = {
      at: "2026-11-16T00:00:00.000Z",
      before: empty.sendBackTiers,
      after: empty.sendBackTiers,
    };
    const report = emptyReport({ sendBackTiersSplit: split });
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(report);
    vi.mocked(sendBackTierReportLines).mockReturnValue(["TIER-AND-SPLIT-LINE"]);
    const { context, stdout } = contextOf();

    await run(context);

    expect(sendBackTierReportLines).toHaveBeenCalledWith(
      expect.objectContaining({
        sendBackTiers: report.sendBackTiers,
        sendBackTiersSplit: split,
      }),
    );
    expect(stdout.mock.calls[0]?.[0]).toContain("TIER-AND-SPLIT-LINE\n");
  });
});
