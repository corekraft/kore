// The writer tokens and follow-ups a span holds, by tier: each writer's cumulative token
// readings in the span, weighted by its tier's price, and the sends to each tier's writer
// panes. The orchestrating session's tokens are weighted at the main-session model.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { countsBefore, tokenSession } from "./merged-tokens.js";
import { inWindow, type Span } from "./scope.js";
import { tokenStageResolver } from "./stage-of.js";
import { pricedLaunches } from "./writer-join.js";
import { priceWeight } from "./writer-prices.js";

/**
 * The model the orchestrating session runs on. Its token.usage holds no model, so its
 * tokens are weighted at this one, and its dollars use it only where a span has no
 * token.split reading (writer-orchestrate.ts, #1041); an assumption to re-check.
 */
export const MAIN_SESSION_MODEL = "claude-opus-5-5";

/** The latest token reading's event for each session, which names its agent and stage. */
function latestReadings(events: LedgerEvent[]): Map<string, LedgerEvent> {
  const latest = new Map<string, { at: number; event: LedgerEvent }>();
  for (const event of events) {
    if (event.kind !== "token.usage" || event.tokens === undefined) {
      continue;
    }
    const key = tokenSession(event);
    const at = time(event);
    const seen = latest.get(key);
    if (seen === undefined || at >= seen.at) {
      latest.set(key, { at, event });
    }
  }
  return new Map([...latest].map(([key, v]) => [key, v.event]));
}

/** Each priced writer's tier, by session name. */
function tierByAgent(events: LedgerEvent[]): Map<string, string> {
  const tierOf = new Map<string, string>();
  for (const l of pricedLaunches(events)) {
    if (l.agent !== undefined) {
      tierOf.set(l.agent, l.tier);
    }
  }
  return tierOf;
}

/** Each tier's weighted tokens in the span, and the orchestrating session's, weighted at the main-session model. */
export function weightedTokensIn(events: LedgerEvent[], span: Span) {
  const tierOf = tierByAgent(events);
  const stageOf = tokenStageResolver(events);
  const owners = latestReadings(events);
  const end = countsBefore(events, span[1]);
  const start = countsBefore(events, span[0]);
  const byTier = new Map<string, number>();
  const spent = new Set<string>();
  let orchestrate = 0;
  for (const [key, tokens] of end) {
    const owner = owners.get(key);
    if (owner === undefined) {
      continue;
    }
    const delta = tokens - (start.get(key) ?? 0);
    const stage = stageOf(owner);
    if (stage === "orchestrate") {
      orchestrate += delta * (priceWeight(MAIN_SESSION_MODEL) ?? 0);
    }
    const tier =
      stage === "write" && owner.agent !== undefined
        ? tierOf.get(owner.agent)
        : undefined;
    if (tier !== undefined && owner.agent !== undefined) {
      byTier.set(
        tier,
        (byTier.get(tier) ?? 0) + delta * (priceWeight(tier) ?? 0),
      );
      if (delta > 0) {
        spent.add(owner.agent);
      }
    }
  }
  return { byTier, orchestrate, spent };
}

/** Each session's latest result before the span's end, by session name: the outcome word it last wrote. */
export function latestResults(
  events: LedgerEvent[],
  end: number,
): Map<string, { at: number; result: string | undefined }> {
  const latest = new Map<string, { at: number; result: string | undefined }>();
  for (const e of events) {
    if (e.kind !== "session.result" || e.agent === undefined) {
      continue;
    }
    const at = time(e);
    const seen = latest.get(e.agent);
    if (at < end && (seen === undefined || at >= seen.at)) {
      latest.set(e.agent, { at, result: e.result });
    }
  }
  return latest;
}

/** Follow-ups sent in the span to each tier's writer panes. */
export function sendsIn(
  events: LedgerEvent[],
  span: Span,
): Map<string, number> {
  const paneTier = new Map<string, string>();
  for (const l of pricedLaunches(events)) {
    if (l.pane !== undefined) {
      paneTier.set(l.pane, l.tier);
    }
  }
  const sends = new Map<string, number>();
  for (const e of events) {
    const tier =
      e.kind === "session.send" && e.pane !== undefined
        ? paneTier.get(e.pane)
        : undefined;
    if (tier !== undefined && inWindow(span, time(e))) {
      sends.set(tier, (sends.get(tier) ?? 0) + 1);
    }
  }
  return sends;
}
