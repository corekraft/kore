// The flow report's help record: beside the command in flow-commands.ts, kept here so that file stays
// within the line budget. It is a record, not logic.
import type { CommandHelp } from "../runtime/index.js";

export const reportHelp: CommandHelp = {
  purpose:
    "Reads the ledger and prints the flow report over a window: each stage's active, waiting and toil time, work in progress, the lead time from first event to outcome, tokens and sessions per closed idea against a trailing average, and the bottleneck. It writes nothing.",
  when: "When you want to see where the time goes over a span, or read one of the trailing metrics an idea's evaluate will judge.",
  whenNot:
    "For the state of the work right now rather than its flow over time: use status. For one idea's verdict: use evaluate.",
  flags: {
    "min-ideas":
      "The fewest completed ideas before a bottleneck is named: a whole number of at least 1, default 3. Below it the report says there is not enough data to name one.",
    trailing:
      "How many closed ideas the trailing average of tokens and sessions per idea covers: a whole number of at least 1. Default 5, or cost.trailingIdeas in .claude/harness.json when set.",
    "host-days":
      "The days before the window that set the host-pressure baseline: a whole number of at least 1, default 7.",
    "window-effort":
      "The effort the Haiku and Sonnet writer arms are read at: low, medium, high, xhigh or max. Absent, the most common randomized effort is used.",
    "as-of":
      "The instant the report is read as of, an ISO 8601 UTC time such as 2026-01-02T03:04:05Z. Default now.",
    since:
      "The start of the window, inclusive, as an ISO 8601 UTC time. Only ideas open then count, and lead time only for those whose outcome falls inside the window.",
    until:
      "The end of the window, exclusive, as an ISO 8601 UTC time; it must not be before --since.",
    "split-at":
      "A time inside the range (a bound is allowed) that splits send-backs, review rounds, violations and break-even into the time before it and the time from it. The split keys appear only with this flag.",
    idea: "Covers only these issues: issue numbers such as 12 or #12, comma-separated, such as 12,13.",
    ledger:
      "A ledger file to read, relative to the working directory; by default the shared ledger in the main checkout.",
  },
  examples: [
    {
      command:
        "harness flow report --since 2026-11-01T00:00:00Z --until 2026-11-08T00:00:00Z",
      shows:
        "the stage table, lead time and bottleneck for 1 to 8 November 2026, the end excluded",
    },
    {
      command: "harness flow report --json --idea 412,413",
      shows:
        "the same report as one object, covering only issues 412 and 413, with its version, scope and skippedLines",
    },
  ],
  exits: [
    {
      code: 0,
      meaning: "the report is printed",
    },
    {
      code: 1,
      meaning:
        "the harness config (.claude/harness.json) is invalid, or the ledger cannot be opened; the message names the fix",
    },
    {
      code: 2,
      meaning:
        "a flag value is not valid, such as a time that is not ISO 8601 UTC, --since after --until, --split-at outside the range, or a --window-effort that is not one of the five levels",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads the ledger and the cost settings in .claude/harness.json when the checkout has one; writes nothing. Malformed ledger lines are left out and counted as skippedLines",
  },
  seeAlso: ["evaluate", "retro due", "status"],
};
