// The per-agent shares of the weekly ceiling (#1048, spec #1030): each role's plan-weighted tokens
// in the trailing week over the ceiling, a true weekly rate. The main-session row adds the token
// totals of sessions with no recorded model, priced at the assumed model (a floor), and says so
// until its model is recorded. A row below the minimum count of sessions is insufficient, and a
// model with no plan weight is named, never read as zero.

import type { LedgerEvent } from "../ledger/index.js";
import type { Span } from "./scope.js";
import { rowOf } from "./cost-waiting-agents.js";
import { assumedPartIn } from "./cost-waiting-shares-assumed.js";
import { levelOf, readingOf, type ShareUnit } from "./cost-waiting-shares.js";
import {
  RATE_DAYS,
  RATE_LABEL,
  type AgentShares,
  type ShareReading,
} from "./cost-waiting-shares-types.js";
import { sessionsInWindow } from "./cost-waiting-support.js";
import {
  AGENT_ROLES,
  type AgentRow,
  type CostWaitingOptions,
} from "./cost-waiting-types.js";

const ALL_ROWS: AgentRow[] = [...AGENT_ROLES, "orchestrate", "other"];

interface RowSpend {
  sessions: number;
  plan: number;
  unweighted: Set<string>;
  basis?: string;
}

/** The week's sessions, bucketed by the row each belongs to. */
function spendByRow(
  events: LedgerEvent[],
  week: Span,
  options: CostWaitingOptions,
): Map<AgentRow, RowSpend> {
  const rows = new Map<AgentRow, RowSpend>();
  for (const session of sessionsInWindow(events, week, options.prices)) {
    const row = rowOf(session);
    const spend = rows.get(row) ?? {
      sessions: 0,
      plan: 0,
      unweighted: new Set<string>(),
    };
    spend.sessions += 1;
    spend.plan += session.plan;
    session.unpriced.forEach((model) => spend.unweighted.add(model));
    rows.set(row, spend);
  }
  return rows;
}

/**
 * Adds the main session's token totals with no recorded model, priced at the assumed model, to its
 * row, and labels the row: assumed model, or recorded and assumed model where it has both.
 */
function withAssumedPart(
  rows: Map<AgentRow, RowSpend>,
  events: LedgerEvent[],
  week: Span,
): void {
  const assumed = assumedPartIn(events, week);
  if (assumed === undefined) {
    return;
  }
  const main = rows.get("orchestrate") ?? {
    sessions: 0,
    plan: 0,
    unweighted: new Set<string>(),
  };
  const recorded = main.sessions > 0;
  main.sessions += assumed.sessions;
  main.plan += assumed.plan;
  assumed.unweighted.forEach((model) => main.unweighted.add(model));
  main.basis = recorded ? "recorded and assumed model" : "assumed model";
  rows.set("orchestrate", main);
}

/** One row's reading: a model with no plan weight named, a count below the minimum insufficient, else its share. */
function rowReading(
  spend: RowSpend | undefined,
  options: CostWaitingOptions,
): { reading: ShareReading; unit: ShareUnit | undefined } {
  const ceiling = options.weeklyTokenCeiling;
  const unit: ShareUnit = {
    plan: spend?.plan ?? 0,
    unweighted: [...(spend?.unweighted ?? [])].sort(),
    ...(spend?.basis === undefined ? {} : { basis: spend.basis }),
  };
  const sessions = spend?.sessions ?? 0;
  if (unit.unweighted.length === 0 && sessions < options.minimum) {
    return {
      reading: {
        label: RATE_LABEL,
        status: "insufficient",
        units: sessions,
        needed: options.minimum,
      },
      unit: undefined,
    };
  }
  return { reading: readingOf(RATE_LABEL, unit, { ceiling }), unit };
}

/**
 * Every row's share over the week, each named row present even with no session in it. The level is
 * the sum of the rows read, with the median and p90 over those rows; each row is already read at
 * the minimum count of sessions, so the level needs one row.
 */
export function agentSharesIn(
  events: LedgerEvent[],
  week: Span,
  options: CostWaitingOptions,
): AgentShares {
  const spend = spendByRow(events, week, options);
  withAssumedPart(spend, events, week);
  const read = new Map<AgentRow, ReturnType<typeof rowReading>>(
    ALL_ROWS.map((name) => [name, rowReading(spend.get(name), options)]),
  );
  const reading = (name: AgentRow): ShareReading =>
    read.get(name)?.reading ?? rowReading(undefined, options).reading;
  const units = [...read.values()].flatMap((row) =>
    row.unit === undefined ? [] : [row.unit],
  );
  return {
    ...levelOf(RATE_LABEL, units, {
      ceiling: options.weeklyTokenCeiling,
      minimum: 1,
    }),
    days: RATE_DAYS,
    rows: {
      writer: reading("writer"),
      reviewer: reading("reviewer"),
      judge: reading("judge"),
      verifier: reading("verifier"),
      reader: reading("reader"),
      judgment: reading("judgment"),
      advisor: reading("advisor"),
      orchestrate: reading("orchestrate"),
      other: reading("other"),
    },
  };
}
