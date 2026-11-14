import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildReport,
  DEFAULT_COST,
  MIN_COMPLETED_IDEAS,
  parseHarnessConfig,
} from "../flow/index.js";
import { isTimestamp } from "../ledger/index.js";
import type { CommandContext } from "../runtime/index.js";
import { flowCommands } from "./flow-commands.js";
import { openLedger } from "./ledger-commands.js";
import {
  contextOf,
  emptyReport,
  ledgerOf,
  populatedReport,
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

const CONFIG = "/repo/harness.yaml";

const run = (context: CommandContext) => flowCommands.report?.run(context);

describe("flow report: flags", () => {
  it("refuses a --min-ideas below one, naming the valid range, and reads nothing", async () => {
    const { context, stderr } = contextOf({ "min-ideas": "0" });
    expect(await run(context)).toBe(2);
    expect(stderr).toHaveBeenCalledWith(
      'Invalid --min-ideas "0". Use a whole number of at least 1.\n',
    );
    expect(openLedger).not.toHaveBeenCalled();
  });

  it("refuses a --trailing that is not a whole number, and refuses a timestamp that is not ISO 8601", async () => {
    const { context, stderr } = contextOf({ trailing: "x" });
    expect(await run(context)).toBe(2);
    expect(stderr).toHaveBeenCalledWith(
      'Invalid --trailing "x". Use a whole number of at least 1.\n',
    );
    vi.mocked(isTimestamp).mockReturnValue(false);
    const next = contextOf({ "as-of": "yesterday" });
    expect(await run(next.context)).toBe(2);
    expect(next.stderr).toHaveBeenCalledWith(
      'Invalid --as-of "yesterday". Use an ISO 8601 UTC time such as 2026-01-02T03:04:05Z.\n',
    );
  });

  it("refuses a --since after --until, and tells the user to swap them", async () => {
    vi.mocked(isTimestamp).mockReturnValue(true);
    const { context, stderr } = contextOf({
      since: "2026-02-01T00:00:00Z",
      until: "2026-01-01T00:00:00Z",
    });
    expect(await run(context)).toBe(2);
    expect(stderr).toHaveBeenCalledWith(
      "Invalid --since 2026-02-01T00:00:00.000Z: it is after --until 2026-01-01T00:00:00.000Z. Swap them.\n",
    );
  });

  it.each([["since"], ["until"]])(
    "refuses a --%s that is not a timestamp, naming the flag and the value",
    async (name) => {
      vi.mocked(isTimestamp).mockReturnValue(false);
      const { context, stderr } = contextOf({ [name]: "soon" });
      expect(await run(context)).toBe(2);
      expect(stderr).toHaveBeenCalledWith(
        "Invalid --" +
          name +
          ' "soon". Use an ISO 8601 UTC time such as 2026-01-02T03:04:05Z.\n',
      );
    },
  );

  it("refuses an --idea that is not an issue number, and says what to use", async () => {
    const { context, stderr } = contextOf({ idea: "12,abc" });
    expect(await run(context)).toBe(2);
    expect(stderr).toHaveBeenCalledWith(
      'Invalid --idea "12,abc". Use issue numbers such as #12 or 12,13.\n',
    );
  });
});

describe("flow report: what it builds", () => {
  it("builds the report as of now, with the default threshold and cost, when no flag is given", async () => {
    const { context } = contextOf();
    ledgerOf([{ kind: "x" }], 2);
    vi.mocked(buildReport).mockReturnValue(emptyReport());

    expect(await run(context)).toBe(0);
    expect(buildReport).toHaveBeenCalledWith([{ kind: "x" }], {
      asOf: NOW,
      minCompletedIdeas: MIN_COMPLETED_IDEAS,
      cost: DEFAULT_COST,
    });
  });

  it("passes the parsed window, ideas, threshold and trailing count through to the report", async () => {
    vi.mocked(isTimestamp).mockReturnValue(true);
    const { context } = contextOf({
      "min-ideas": "4",
      trailing: "3",
      "as-of": "2026-01-05T00:00:00Z",
      since: "2026-01-01T00:00:00Z",
      until: "2026-01-04T00:00:00Z",
      idea: "#12,13",
    });
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(emptyReport());

    await run(context);
    expect(buildReport).toHaveBeenCalledWith([], {
      asOf: new Date("2026-01-05T00:00:00Z"),
      minCompletedIdeas: 4,
      since: new Date("2026-01-01T00:00:00Z"),
      until: new Date("2026-01-04T00:00:00Z"),
      ideas: ["#12", "#13"],
      trailingIdeas: 3,
      cost: { ...DEFAULT_COST, trailingIdeas: 3 },
    });
  });
});

describe("flow report: cost settings", () => {
  it("uses the cost settings from the harness config when the checkout has one", async () => {
    const { context, exists, readFile } = contextOf();
    const config = { ...DEFAULT_COST, trailingIdeas: 9 };
    vi.mocked(join).mockReturnValue(CONFIG);
    exists.mockResolvedValue(true);
    readFile.mockResolvedValue("cost: {}");
    vi.mocked(parseHarnessConfig).mockReturnValue({ cost: config });
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(emptyReport());

    await run(context);
    expect(parseHarnessConfig).toHaveBeenCalledWith(
      "cost: {}",
      expect.any(String),
    );
    expect(buildReport).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ cost: config }),
    );
  });

  it("refuses a harness config it cannot parse, and reports the parse error with exit 1", async () => {
    const { context, stderr, exists } = contextOf({}, true);
    vi.mocked(join).mockReturnValue(CONFIG);
    exists.mockResolvedValue(true);
    vi.mocked(parseHarnessConfig).mockReturnValue({ error: "bad cost" });

    expect(await run(context)).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      `${JSON.stringify({ error: "bad cost" })}\n`,
    );
    expect(buildReport).not.toHaveBeenCalled();
  });

  it("uses the default cost when the root cannot be read, rather than failing the report", async () => {
    const { context, root, exists } = contextOf();
    root.mockRejectedValue(new Error("no root"));
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(emptyReport());

    expect(await run(context)).toBe(0);
    expect(exists).not.toHaveBeenCalled();
  });
});

describe("flow report: output", () => {
  it("prints the report as one JSON object with the skipped line count under --json", async () => {
    const { context, stdout } = contextOf({}, true);
    ledgerOf([], 3);
    vi.mocked(buildReport).mockReturnValue(emptyReport());

    expect(await run(context)).toBe(0);
    expect(stdout).toHaveBeenCalledWith(
      `${JSON.stringify({ ...emptyReport(), skippedLines: 3 })}\n`,
    );
  });
});

describe("flow report: human lines", () => {
  it("prints the human report with its lines in order, and no bottleneck when there is none", async () => {
    const { context, stdout } = contextOf();
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(emptyReport());

    await run(context);
    expect(stdout).toHaveBeenCalledWith(
      [
        "Flow report as of 2026-01-02T03:04:05Z: 2 of 3 ideas completed",
        "Covering the whole ledger",
        "Lead time: no completed ideas",
        "Tokens per idea: insufficient history, 1 of 3 closed ideas",
        "Sessions per idea: insufficient history, 1 of 3 closed ideas",
        "Unmapped events: 0",
        "Attribution: no stamped sessions yet, so nothing is measured",
        "Main red: no check runs on main",
        "Reverts: 0 of 0 merged changes",
        "Live runs: no nightly runs",
        "Owner minutes per merged change: none recorded",
        "Guard blocks: none",
        "No bottleneck yet.",
        "",
      ].join("\n"),
    );
  });

  it("names the bottleneck with its share, and counts malformed ledger lines last", async () => {
    const { context, stdout } = contextOf();
    ledgerOf([], 2);
    vi.mocked(buildReport).mockReturnValue(
      emptyReport({
        bottleneck: { stage: "review", share: 0.5 },
        guardBlocks: [{ rule: "push", blocks: 2 }],
      }),
    );

    await run(context);
    const text = vi.mocked(stdout).mock.calls[0]?.[0] as string;
    expect(text).toContain("Guard blocks: push 2\n");
    expect(text).toContain("Bottleneck: review (50% of waiting)\n");
    expect(text.endsWith("skipped 2 malformed ledger line(s)\n")).toBe(true);
  });
});

describe("flow report: a populated report", () => {
  it("prints each section that has figures: scope, lead time, trends, attribution, outcomes and guard blocks", async () => {
    const { context, stdout } = contextOf();
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(populatedReport());

    await run(context);
    const text = vi.mocked(stdout).mock.calls[0]?.[0] as string;
    expect(text).toContain(
      "Covering from 2026-01-01, until 2026-02-01, ideas #12\n",
    );
    expect(text).toContain("Lead time: 1 ideas, median 90s, max 200s\n");
    expect(text).toContain(
      "Tokens per idea: #12 120, average of the 3 ideas before it 100.46 (worsened)\n",
    );
    expect(text).toContain(
      "Sessions per idea: #12 2, average of the 3 ideas before it 2\n",
    );
    expect(text).toContain(
      "Attribution since 2026-01-01: 8 of 10 events with an idea, 6 with a stage too\n",
    );
    expect(text).toContain("Main red: 1 of 2 check runs on main (50%)\n");
    expect(text).toContain("Reverts: 1 of 4 merged changes\n");
    expect(text).toContain("Live runs: 3 of 3 nightly runs passed (100%)\n");
    expect(text).toContain(
      "Owner minutes per merged change: 5 (20 over 4 merged; an upper bound while agents share the owner's login)\n",
    );
    expect(text).toContain("Guard blocks: push 2\n");
    expect(text).toMatch(
      /review .*active 60s .*waiting 30s .*4 events .*wip peak 2 avg 1\.5 .*toil start 1s stop 2s wait 3s retry 4s/,
    );
  });
});

describe("flow report: ledger", () => {
  it("refuses when the ledger cannot open, and prints nothing", async () => {
    const { context, stderr, stdout } = contextOf();
    vi.mocked(openLedger).mockResolvedValue({ error: "no ledger here" });

    expect(await run(context)).toBe(1);
    expect(stderr).toHaveBeenCalledWith("no ledger here\n");
    expect(stdout).not.toHaveBeenCalled();
    expect(buildReport).not.toHaveBeenCalled();
  });
});
