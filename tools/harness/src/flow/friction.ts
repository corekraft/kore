import { KINDS, type LedgerEvent } from "../ledger/index.js";
import {
  closedIdeas,
  DEFAULT_MAX_INCREASE,
  DEFAULT_TRAILING_IDEAS,
  trailingMetric,
  type CostMetric,
} from "./cost.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

/** Where a friction event came from: a hook rule, a `kore` command, or a pane. */
export interface FrictionSource {
  kind: "hook rule" | "command" | "pane";
  source: string;
  events: number;
}

export interface Friction {
  /** Friction events in the range. */
  total: number;
  /** Each source, most events first, ties by source name. */
  sources: FrictionSource[];
  /** Events whose kind this report does not know; they are left out and counted here. */
  unknownKinds: number;
}

export interface ReworkMetrics {
  trailingIdeas: number;
  /** Writer escalations per closed idea. */
  escalationsPerIdea: CostMetric;
  /** Judge send-backs per closed idea. */
  sendBacksPerIdea: CostMetric;
  /** Friction events per closed idea. */
  frictionPerIdea: CostMetric;
}

const KNOWN = new Set<string>(KINDS);

/** The source of a friction event; undefined for a kind that is not friction. */
function sourceOf(
  e: LedgerEvent,
): Pick<FrictionSource, "kind" | "source"> | undefined {
  switch (e.kind) {
    case "guard.block":
    case "guard.audit":
      return { kind: "hook rule", source: e.label ?? "unknown" };
    case "kore.retry":
      return { kind: "command", source: e.label ?? "unknown" };
    case "pane.interrupted":
      return { kind: "pane", source: e.pane ?? e.session ?? "unknown" };
    default:
      return undefined;
  }
}

/** Friction in range by source: hook blocks and audit warnings, one per `kore` retry, interrupted panes. */
export function friction(events: LedgerEvent[], window: Span): Friction {
  const counts = new Map<string, FrictionSource>();
  let unknownKinds = 0;
  for (const e of events) {
    if (!KNOWN.has(e.kind)) {
      unknownKinds += 1;
      continue;
    }
    const found = sourceOf(e);
    if (found === undefined || !inWindow(window, time(e))) {
      continue;
    }
    const key = `${found.kind}\0${found.source}`;
    const seen = counts.get(key) ?? { ...found, events: 0 };
    seen.events += 1;
    counts.set(key, seen);
  }
  const sources = [...counts.values()].sort(
    (a, b) => b.events - a.events || a.source.localeCompare(b.source),
  );
  return {
    total: sources.reduce((sum, s) => sum + s.events, 0),
    sources,
    unknownKinds,
  };
}

const countOf = (own: LedgerEvent[], isKind: (e: LedgerEvent) => boolean) =>
  own.filter(isKind).length;

/** Rework and friction per closed idea, each with a trailing average, from ledger events only. */
export function reworkMetrics(
  byIdea: Map<string, LedgerEvent[]>,
  window: Span,
  trailingIdeas = DEFAULT_TRAILING_IDEAS,
  maxIncrease = DEFAULT_MAX_INCREASE,
): ReworkMetrics {
  const closed = closedIdeas(byIdea, window);
  const per = (isKind: (e: LedgerEvent) => boolean) =>
    trailingMetric(
      closed.map(({ idea, own }) => ({ idea, value: countOf(own, isKind) })),
      trailingIdeas,
      { maxIncrease },
    );
  return {
    trailingIdeas,
    escalationsPerIdea: per((e) => e.kind === "escalation"),
    sendBacksPerIdea: per((e) => e.kind === "send-back"),
    frictionPerIdea: per((e) => sourceOf(e) !== undefined),
  };
}
