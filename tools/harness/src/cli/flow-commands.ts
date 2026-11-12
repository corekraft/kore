import {
  MIN_COMPLETED_IDEAS,
  REPORT_VERSION,
  buildReport,
  type FlowReport,
} from "../flow/index.js";
import { isTimestamp } from "../ledger/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { openLedger } from "./ledger-commands.js";

/** The documented `--json` shape (docs/guides/contributor.md, "Flow report"). */
interface Printed extends FlowReport {
  /** Ledger lines that were not valid events and were left out. */
  skippedLines: number;
}

type Parsed = { asOf: Date; minCompletedIdeas: number } | { error: string };

function parseFlags({ options, deps }: CommandContext): Parsed {
  const min = options["min-ideas"];
  let minCompletedIdeas = MIN_COMPLETED_IDEAS;
  if (min !== undefined) {
    minCompletedIdeas = typeof min === "string" ? Number(min) : Number.NaN;
    if (!/^\d+$/.test(String(min)) || minCompletedIdeas < 1) {
      return {
        error: `Invalid --min-ideas "${String(min)}". Use a whole number of at least 1.`,
      };
    }
  }
  const given = options["as-of"];
  if (given === undefined) {
    return { asOf: deps.clock.now(), minCompletedIdeas };
  }
  if (typeof given !== "string" || !isTimestamp(given)) {
    return {
      error: `Invalid --as-of "${String(given)}". Use an ISO 8601 UTC time such as 2026-01-02T03:04:05Z.`,
    };
  }
  return { asOf: new Date(given), minCompletedIdeas };
}

const seconds = (value: number) => `${Math.round(value)}s`;

function text(report: Printed): string {
  const rows = report.stages.map((s) =>
    [
      s.stage.padEnd(15),
      `active ${seconds(s.activeSeconds)}`.padEnd(16),
      `waiting ${seconds(s.waitingSeconds)}`.padEnd(17),
      `${s.events} events`,
    ].join(" "),
  );
  const lines = [
    `Flow report as of ${report.asOf}: ${report.ideas.completed} of ${report.ideas.total} ideas completed`,
    ...rows,
    `Unmapped events: ${report.unmappedEvents}`,
    report.bottleneck === null
      ? (report.bottleneckNote ?? "No bottleneck.")
      : `Bottleneck: ${report.bottleneck.stage} (${Math.round(report.bottleneck.share * 100)}% of waiting)`,
  ];
  if (report.skippedLines > 0) {
    lines.push(`skipped ${report.skippedLines} malformed ledger line(s)`);
  }
  return `${lines.join("\n")}\n`;
}

const report: Command = {
  summary: `map ledger events to stages; per stage active, waiting and event counts, and the bottleneck (--min-ideas N, default ${MIN_COMPLETED_IDEAS}; --as-of TIME; --ledger PATH; --json is one object, version ${REPORT_VERSION}: version, asOf, ideas, minCompletedIdeas, stages, bottleneck, bottleneckNote, unmappedEvents, skippedLines)`,
  options: { "min-ideas": "string", "as-of": "string", ledger: "string" },
  async run(context) {
    const flags = parseFlags(context);
    const { deps, json } = context;
    const fail = (message: string, code: number) => {
      deps.stderr(
        json ? `${JSON.stringify({ error: message })}\n` : `${message}\n`,
      );
      return code;
    };
    if ("error" in flags) {
      return fail(flags.error, 2);
    }
    const opened = await openLedger(context);
    if ("error" in opened) {
      return fail(opened.error, 1);
    }
    const { events, skipped } = await opened.ledger.list({});
    const printed: Printed = {
      ...buildReport(events, flags),
      skippedLines: skipped,
    };
    deps.stdout(json ? `${JSON.stringify(printed)}\n` : text(printed));
    return 0;
  },
};

export const flowCommands: Record<string, Command> = { report };
