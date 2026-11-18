// The agent rows of the token cost figures (#1019): each role's sessions in the window, with the
// median and 90th percentile of their dollars and tokens, and the share of the weekly ceiling.

import type { LedgerEvent } from "../ledger/index.js";
import type { Span } from "./scope.js";
import {
  sessionsInWindow,
  shareOf,
  summaryOf,
  type SessionWindow,
} from "./cost-waiting-support.js";
import { secondsBySession, type SessionSeconds } from "./cost-waiting-time.js";
import {
  AGENT_ROLES,
  type AgentFigure,
  type AgentRow,
  type CostWaitingOptions,
} from "./cost-waiting-types.js";

const isRole = (word: string) =>
  (AGENT_ROLES as readonly string[]).includes(word);

/** The row a session belongs to: its role, else the main session when no agent names it, else other. */
export function rowOf(session: SessionWindow): AgentRow {
  const role = session.key.split("-").reverse().find(isRole);
  if (role !== undefined) {
    return role as AgentRow;
  }
  return session.named ? "other" : "orchestrate";
}

interface Bucket {
  dollars: number[];
  tokens: number[];
  active: number[];
  waiting: number[];
  plan: number;
  unpriced: Set<string>;
}

/** The sessions of each row, bucketed; a row holds every session's values and any model it cannot price. */
function bucketsOf(
  sessions: SessionWindow[],
  seconds: Map<string, SessionSeconds>,
): Map<AgentRow, Bucket> {
  const rows = new Map<AgentRow, Bucket>();
  for (const session of sessions) {
    const row = rowOf(session);
    const bucket = rows.get(row) ?? {
      dollars: [],
      tokens: [],
      active: [],
      waiting: [],
      plan: 0,
      unpriced: new Set<string>(),
    };
    const time = seconds.get(session.key) ?? { active: 0, waiting: 0 };
    bucket.dollars.push(session.dollars);
    bucket.tokens.push(session.tokens);
    bucket.active.push(time.active);
    bucket.waiting.push(time.waiting);
    bucket.plan += session.plan;
    for (const model of session.unpriced) {
      bucket.unpriced.add(model);
    }
    rows.set(row, bucket);
  }
  return rows;
}

/** One row's figure: unpriced when a session ran on an unpriced model, insufficient below the minimum, else measured. */
function figureOf(
  bucket: Bucket | undefined,
  options: CostWaitingOptions,
): AgentFigure {
  if (bucket === undefined) {
    return { status: "insufficient", sessions: 0, needed: options.minimum };
  }
  if (bucket.unpriced.size > 0) {
    return {
      status: "insufficient prices",
      models: [...bucket.unpriced].sort(),
    };
  }
  const sessions = bucket.dollars.length;
  if (sessions < options.minimum) {
    return { status: "insufficient", sessions, needed: options.minimum };
  }
  return {
    status: "measured",
    sessions,
    dollars: summaryOf(bucket.dollars),
    tokens: summaryOf(bucket.tokens),
    activeSeconds: summaryOf(bucket.active),
    waitingSeconds: summaryOf(bucket.waiting),
    ceilingShare: shareOf(bucket.plan, options.weeklyTokenCeiling),
  };
}

/** Every agent row over the window, each named row present even with no session in it. */
export function agentRowsIn(
  events: LedgerEvent[],
  window: Span,
  options: CostWaitingOptions,
): Record<AgentRow, AgentFigure> {
  const rows = bucketsOf(
    sessionsInWindow(events, window, options.prices),
    secondsBySession(events, window),
  );
  const names: AgentRow[] = [...AGENT_ROLES, "orchestrate", "other"];
  return Object.fromEntries(
    names.map((row) => [row, figureOf(rows.get(row), options)]),
  ) as Record<AgentRow, AgentFigure>;
}
