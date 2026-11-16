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

describe("flow report: owner questions (#859)", () => {
  it("prints the questions per merged change, with the trailing average and whether it worsened", async () => {
    const { context, stdout } = contextOf();
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(populatedReport());

    await run(context);
    const text = vi.mocked(stdout).mock.calls[0]?.[0] as string;

    expect(text).toContain(
      "Owner questions per merged change: 1.5 (6 questions over 4 merged changes); average 1 over the trailing 7 days (worsened)\n",
    );
  });

  it("says there were questions but no merged change, rather than a zero rate, when nothing merged", async () => {
    const { context, stdout } = contextOf();
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(emptyReport());

    await run(context);
    const text = vi.mocked(stdout).mock.calls[0]?.[0] as string;

    expect(text).toContain(
      "Owner questions: 0 with no merged change in this range\n",
    );
    expect(text).not.toContain("per merged change: 0");
  });

  it("carries the owner question figure in --json", async () => {
    const { context, stdout } = contextOf({}, true);
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(populatedReport());

    await run(context);
    const json = JSON.parse(vi.mocked(stdout).mock.calls[0]?.[0] as string);

    expect(json.ownerQuestions).toEqual(populatedReport().ownerQuestions);
  });
});
