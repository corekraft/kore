import { describe, expect, it, vi } from "vitest";
import { buildReport } from "../flow/index.js";
import { flowCommands } from "./flow-commands.js";
import { EMPTY_VIOLATION_LINES } from "./flow-commands-merged-support.js";
import { contextOf, emptyReport, ledgerOf } from "./flow-commands-support.js";
import type { CommandContext } from "../runtime/index.js";

vi.mock("../flow/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flow/index.js")>()),
  buildReport: vi.fn(),
}));
vi.mock("./ledger-commands.js");

const run = (context: CommandContext) => flowCommands.report?.run(context);

const EMPTY_WRITING_LINES = [
  "  Writing attributed to an idea: not read, 0 session(s), 5 needed",
  "  Writing in no idea (unattributed writer tokens): 0 session(s), 0 tokens, $0",
  "  Writing in no pull request (unattributed writer tokens): 0 session(s), 0 tokens, $0",
  "  Pull requests opened with no link to a writer (unjoinable): 0",
  "  Shares of the weekly token ceiling (plan-weighted tokens; ceiling not set):",
  "    Per agent, a rate over the trailing 7 days, of the weekly ceiling: not read, 0 role(s), 1 needed",
  "    Per merged change, a size, of one week's ceiling: not read, 0 change(s), 5 needed",
  "    Per idea, a size, of one week's ceiling: not read, 0 idea(s), 5 needed",
];

/** The human report of an empty range, in order (#1090 adds the finish lines after friction). */
const EMPTY_HUMAN_TEXT = [
  "Flow report as of 2026-01-02T03:04:05Z: 2 of 3 ideas completed",
  "Covering the whole ledger",
  "Lead time: no completed ideas",
  "Tokens per idea: insufficient history, 1 of 3 closed ideas",
  "Sessions per idea: insufficient history, 1 of 3 closed ideas",
  "Escalations per idea: insufficient history, 1 of 6 closed ideas",
  "Send-backs per idea: insufficient history, 1 of 6 closed ideas",
  "Friction events per idea: insufficient history, 1 of 6 closed ideas",
  "Send-backs by category, per PR head: declaration 0, pattern-mismatch 0, failed-check 0, conflict 0, missing-proof 0, rule-break 0, scope 0, wrong-statement 0, other 0; legacy 0 (recorded before 2026-11-16, when a category became required); uncategorised 0; categorised 0; no categorised send-backs",
  "Send-backs by category, per merged change: declaration 0, pattern-mismatch 0, failed-check 0, conflict 0, missing-proof 0, rule-break 0, scope 0, wrong-statement 0, other 0; legacy 0 (recorded before 2026-11-16, when a category became required); uncategorised 0; categorised 0; no categorised send-backs",
  "Send-backs by category, unlinked row (0 merged changes with no writer tier): declaration 0, pattern-mismatch 0, failed-check 0, conflict 0, missing-proof 0, rule-break 0, scope 0, wrong-statement 0, other 0; legacy 0 (recorded before 2026-11-16, when a category became required); uncategorised 0; categorised 0; no categorised send-backs; rework not read, no writer tier",
  "Failed review rounds and review coverage, unlinked row (0 merged changes with no writer tier): failed review rounds 0; rework not read, no writer tier; review coverage 0 of 0 merged changes, not read",
  ...EMPTY_VIOLATION_LINES,
  "Passed reviews later sent back for a rule break: no recorded reviews in this range",
  "Reviews that found a violation: no recorded reviews in this range",
  "Re-reviews of sampled passed reviews: no re-reviews in this range",
  "Friction: none",
  "Finish detection: no results with a pane in this range",
  "Finish lag in minutes, detected and late: no finish with a lag",
  "Silent sessions: 0 (last token usage more than 900s earlier and no RESULT since; background-command excluded 0, open-question excluded 0); recorded pane.stalled: 0",
  "Unmapped events: 0",
  "Attribution: no stamped sessions yet, so nothing is measured",
  "Main red: no check runs on main",
  "Reverts: 0 of 0 merged changes",
  "Live runs: no nightly runs",
  "Owner minutes per merged change: none recorded",
  "Guard blocks: none",
  "Host pressure: no samples in this range",
  "Owner questions: 0 with no merged change in this range",
  "Advisor decisions overturned: 0 of 0 made; none made in this range",
  "Owner-routed questions: 0 (advisor-routed 0); by signal: reserved-category 0, matched 0, advisor-files 0, escalated 0, unclassifiable 0",
  "Waiting on a person: no question asked in this range",
  "Handovers from the main session: insufficient, no handover source",
  "Compactions: insufficient, no compaction source",
  "Main-session setups: insufficient, no setup source",
  "Tokens per merged change: not read, 0 merged changes in this range (5 needed); no average: 0 merged changes in the trailing 7 days (5 needed)",
  "Send-backs per merged change: not read, 0 merged changes in this range (5 needed); no average: 0 merged changes in the trailing 7 days (5 needed)",
  "Lead time per merged change: not read, 0 of 0 merged changes measured in this range (5 needed); no average: 0 of 0 merged changes measured in the trailing 7 days (5 needed)",
  "All-in cost per merged change: not read, 0 merged changes in this range (5 needed)",
  "All-in cost per merged change, trailing average: no average: 0 merged changes in the trailing 7 days (5 needed)",
  "Writer tiers beyond cost: not read, 0 merged changes in this range (5 needed)",
  "Writer arms, all merged changes: insufficient merged changes, Haiku 0 and Sonnet 0 (5 needed in each arm); not read.",
  "Writer arms: 0 merged changes on an arm with no label recorded, in the overall figure only. The report gives no verdict; the deciding rule is the owner's, recorded on the idea.",
  "Writer arms: window effort high, set with --window-effort. Left out of the arms and counted: 0 randomized launches at a different effort, 0 launches with no recorded effort, 0 launches not randomized.",
  "Token cost beside waiting time (#1019):",
  "  Merged changes: not read, 0 joined (5 needed)",
  ...EMPTY_WRITING_LINES,
  "No bottleneck yet.",
  "",
].join("\n");

describe("flow report: human lines", () => {
  it("prints the human report with its lines in order, and no bottleneck when there is none", async () => {
    const { context, stdout } = contextOf();
    ledgerOf();
    vi.mocked(buildReport).mockReturnValue(emptyReport());

    await run(context);
    expect(stdout).toHaveBeenCalledWith(EMPTY_HUMAN_TEXT);
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
