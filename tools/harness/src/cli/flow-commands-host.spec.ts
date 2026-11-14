import { describe, expect, it, vi } from "vitest";
import { buildReport } from "../flow/index.js";
import type { CommandContext } from "../runtime/index.js";
import { flowCommands } from "./flow-commands.js";
import {
  contextOf,
  emptyReport,
  ledgerOf,
  populatedReport,
} from "./flow-commands-support.js";

vi.mock("node:path");
vi.mock("../flow/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flow/index.js")>()),
  buildReport: vi.fn(),
}));
vi.mock("./ledger-commands.js");

const run = (context: CommandContext) => flowCommands.report?.run(context);

describe("flow report: host pressure lines", () => {
  it("prints one line per session count with its figures and which rose above their baseline", async () => {
    const { context, stdout } = contextOf();
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(populatedReport());
    await run(context);
    const text = vi.mocked(stdout).mock.calls[0]?.[0] as string;
    expect(text).toContain(
      "Host pressure: 5 samples; flagged when above the median of the 7 days before by more than their spread\n",
    );
    expect(text).toContain(
      "  3 sessions, platform up: 4 samples, swap median 4.3 GiB peak 6 GiB, load median 3.46 peak 9 (worsened: swap)\n",
    );
    expect(text).toContain(
      "  1 sessions, loop only: 1 samples, swap median n/a peak n/a, load median 1 peak 1\n",
    );
  });
});

describe("flow report: host pressure", () => {
  it("says no samples, not zeros, when the range holds none", async () => {
    const { context, stdout } = contextOf();
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(emptyReport());

    await run(context);
    const text = vi.mocked(stdout).mock.calls[0]?.[0] as string;
    expect(text).toContain("Host pressure: no samples in this range\n");
    expect(text).not.toContain("swap median");
  });

  it("passes --host-days to the report, and refuses one that is not a whole number", async () => {
    const { context } = contextOf({ "host-days": "3" });
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(emptyReport());
    await run(context);
    expect(buildReport).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ hostDays: 3 }),
    );

    const bad = contextOf({ "host-days": "0" });
    vi.mocked(buildReport).mockClear();
    expect(await run(bad.context)).toBe(2);
    expect(bad.stderr).toHaveBeenCalledWith(
      'Invalid --host-days "0". Use a whole number of at least 1.\n',
    );
    expect(buildReport).not.toHaveBeenCalled();
  });

  it("carries the host figures in --json", async () => {
    const { context, stdout } = contextOf({}, true);
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(populatedReport());
    await run(context);
    const json = JSON.parse(vi.mocked(stdout).mock.calls[0]?.[0] as string);
    expect(json.hostPressure).toEqual(populatedReport().hostPressure);
  });
});
