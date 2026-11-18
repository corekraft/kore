// The merged-change rows of the token cost figures (#1019): each merged pull request in the window
// with its all-in dollars and tokens (the writer cost attribution, #1008), its time from the first
// writer launch to merge, and its wait from opening to merge (the open-PR span of the GitHub waits).

import type { LedgerEvent } from "../ledger/index.js";
import { firstTime } from "./github-waits.js";
import type { Span } from "./scope.js";
import { round, summaryOf, tokenPricesOf } from "./cost-waiting-support.js";
import {
  type CostWaitingOptions,
  type MergedChangeFigure,
  type MergedChanges,
} from "./cost-waiting-types.js";
import { linkedAgents } from "./writer-join.js";
import {
  type MergedChangeDollars,
  type WriterDollars,
  writerDollarsIn,
} from "./writer-attribution.js";

/** A merged change's all-in parts: its writer, its reviewer and its share of the shared spend. */
function allInOf(change: MergedChangeDollars, all: WriterDollars): number {
  const shared =
    (all.shared.judge + all.shared.orchestrate) / all.changes.length;
  return (change.writer ?? 0) + change.reviewer + shared;
}

/** One merged change's row: its all-in dollars and tokens, and its seconds from launch and from opening to merge. */
function changeRow(
  events: LedgerEvent[],
  change: MergedChangeDollars,
  dollars: WriterDollars,
  tokens: WriterDollars,
  agent: string | undefined,
): MergedChangeFigure {
  const number = change.number;
  const joined = change.writer !== undefined;
  const tokenChange = tokens.changes.find((c) => c.number === number);
  const mergedAt = firstTime(
    events,
    (e) => e.kind === "pr.merged" && e.number === number,
  );
  const openedAt = firstTime(
    events,
    (e) => e.kind === "pr.opened" && e.number === number,
  );
  const launchedAt =
    agent === undefined
      ? undefined
      : firstTime(
          events,
          (e) => e.kind === "session.launch" && e.agent === agent,
        );
  return {
    number,
    joined,
    dollars: joined ? round(allInOf(change, dollars)) : null,
    tokens:
      joined && tokenChange !== undefined
        ? round(allInOf(tokenChange, tokens))
        : null,
    launchToMergeSeconds:
      joined && launchedAt !== undefined && mergedAt !== undefined
        ? (mergedAt - launchedAt) / 1000
        : null,
    waitSeconds:
      mergedAt !== undefined && openedAt !== undefined
        ? (mergedAt - openedAt) / 1000
        : null,
  };
}

/** The merged changes in the window, with their summaries once the joined count reaches the minimum. */
export function mergedChangesIn(
  events: LedgerEvent[],
  window: Span,
  options: CostWaitingOptions,
): MergedChanges {
  const dollars = writerDollarsIn(events, window, options.prices);
  const tokens = writerDollarsIn(events, window, tokenPricesOf(events));
  const linked = linkedAgents(events);
  const changes = dollars.changes.map((change) =>
    changeRow(events, change, dollars, tokens, linked.get(change.number)),
  );
  const joined = changes.filter((c) => c.joined);
  const measured = joined.length >= options.minimum;
  return {
    changes,
    status: measured ? "measured" : "insufficient",
    joined: joined.length,
    needed: options.minimum,
    ...(measured
      ? {
          dollars: summaryOf(joined.map((c) => c.dollars ?? 0)),
          tokens: summaryOf(joined.map((c) => c.tokens ?? 0)),
        }
      : {}),
  };
}
