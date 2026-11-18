import { describe, expect, it, vi } from "vitest";
import {
  buildReport,
  DEFAULT_COST,
  MIN_COMPLETED_IDEAS,
} from "../flow/index.js";
import type { CommandContext } from "../runtime/index.js";
import { flowCommands } from "./flow-commands.js";
import { openLedger } from "./ledger-commands.js";
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
vi.mock("./ledger-commands.js");

const run = (context: CommandContext) => flowCommands.report?.run(context);

describe("flow report: the window effort", () => {
  it("refuses a --window-effort that is not a recognized effort, naming the allowed values, and reads nothing", async () => {
    const { context, stderr } = contextOf({ "window-effort": "hihg" });

    expect(await run(context)).toBe(2);
    expect(stderr).toHaveBeenCalledWith(
      'Invalid --window-effort "hihg". Use one of low, medium, high, xhigh, max.\n',
    );
    expect(openLedger).not.toHaveBeenCalled();
  });

  it("passes a recognized --window-effort through to the report", async () => {
    const { context } = contextOf({ "window-effort": "high" });
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(emptyReport());

    expect(await run(context)).toBe(0);
    expect(buildReport).toHaveBeenCalledWith([], {
      asOf: NOW,
      minCompletedIdeas: MIN_COMPLETED_IDEAS,
      windowEffort: "high",
      cost: DEFAULT_COST,
    });
  });

  it("passes no window effort when the flag is absent, so the report defaults it and says so", async () => {
    const { context } = contextOf();
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(emptyReport());

    await run(context);

    expect(vi.mocked(buildReport).mock.calls.at(-1)?.[1]).not.toHaveProperty(
      "windowEffort",
    );
  });
});
