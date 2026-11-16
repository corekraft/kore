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

describe("flow report: review misses (#851)", () => {
  it("prints the passed-then-rule-break ratio and the found-violation share, each with its trailing average", async () => {
    const { context, stdout } = contextOf();
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(populatedReport());

    await run(context);
    const text = vi.mocked(stdout).mock.calls[0]?.[0] as string;

    expect(text).toContain(
      "Passed reviews later sent back for a rule break: 1 of 4 reviews (25%), trailing average 10% over the trailing 7 days (worsened)\n",
    );
    expect(text).toContain(
      "Reviews that found a violation: 2 of 4 (50%), trailing average 20% over the trailing 7 days\n",
    );
  });

  it("says there are no recorded reviews in the range, rather than a rate, when there are none", async () => {
    const { context, stdout } = contextOf();
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(emptyReport());

    await run(context);
    const text = vi.mocked(stdout).mock.calls[0]?.[0] as string;

    expect(text).toContain(
      "Reviews that found a violation: no recorded reviews in this range\n",
    );
    expect(text).not.toContain("0%");
  });

  it("carries the review miss figures in --json, unchanged", async () => {
    const { context, stdout } = contextOf({}, true);
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(populatedReport());

    await run(context);
    const json = JSON.parse(vi.mocked(stdout).mock.calls[0]?.[0] as string);

    expect(json.reviewMisses).toEqual(populatedReport().reviewMisses);
  });
});
