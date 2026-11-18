// The compaction cap the flow report reads its main-session setup labels against (#1046):
// the harness config's number reaches the report, and an unset cap reaches it as absent,
// never as zero. The report and the config parser are mocked (ADR 0098).

import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildReport,
  DEFAULT_COST,
  parseHarnessConfig,
} from "../flow/index.js";
import type { CommandContext } from "../runtime/index.js";
import { flowCommands } from "./flow-commands.js";
import { contextOf, emptyReport, ledgerOf } from "./flow-commands-support.js";

vi.mock("node:path");
vi.mock("../flow/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flow/index.js")>()),
  buildReport: vi.fn(),
  parseHarnessConfig: vi.fn(),
}));
vi.mock("./ledger-commands.js");

const run = (context: CommandContext) => flowCommands.report?.run(context);

describe("flow report: the compaction cap", () => {
  it("passes the config's compaction cap to the report", async () => {
    const { context, exists, readFile } = contextOf();
    vi.mocked(join).mockReturnValue("harness.json");
    exists.mockResolvedValue(true);
    readFile.mockResolvedValue("{}");
    vi.mocked(parseHarnessConfig).mockReturnValue({
      cost: DEFAULT_COST,
      compactionCap: 80_000,
    });
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(emptyReport());

    await run(context);

    expect(vi.mocked(buildReport).mock.calls.at(-1)?.[1].compactionCap).toBe(
      80_000,
    );
  });

  it("passes no cap when the config sets none, never a zero", async () => {
    const { context, exists, readFile } = contextOf();
    vi.mocked(join).mockReturnValue("harness.json");
    exists.mockResolvedValue(true);
    readFile.mockResolvedValue("{}");
    vi.mocked(parseHarnessConfig).mockReturnValue({ cost: DEFAULT_COST });
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(emptyReport());

    await run(context);

    expect(
      vi.mocked(buildReport).mock.calls.at(-1)?.[1].compactionCap,
    ).toBeUndefined();
  });
});
