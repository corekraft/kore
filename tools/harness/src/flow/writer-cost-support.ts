// Shared fixtures for the writer cost specs: ledger events built at a time in milliseconds, and
// the zero figures a tier with nothing in the window reads as.

import type { Kind, LedgerEvent } from "../ledger/index.js";

export const WINDOW: [number, number] = [1000, 2000];
export const ASOF = new Date(10_000);
export const OPTIONS = { trailingDays: 7, minMergedChanges: 5, asOf: ASOF };

export const HAIKU = "claude-haiku-5-5";
export const SONNET = "claude-sonnet-5-5";

export const RELAUNCH_LIMIT =
  "A relaunch on a new session with no idea stamp cannot be joined to the first launch: its merged change takes the relaunch's tier, not the first launch's.";

/** An event at a time in milliseconds, with its occurredAt set to that time. */
export function event(
  ms: number,
  kind: Kind,
  extra: Partial<LedgerEvent> = {},
): LedgerEvent {
  return {
    schema: 1,
    id: String(ms),
    source: "herdr",
    kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
    ...extra,
  } satisfies LedgerEvent;
}

/** A writer launched into a pane on a model tier. */
export const launch = (ms: number, agent: string, pane: string, tier: string) =>
  event(ms, "session.launch", { agent, pane, role: "writer", tier });

/** A writer launched on a model tier and stamped with an idea, as a spawn with --idea records it. */
export const ideaLaunch = (
  ms: number,
  agent: string,
  pane: string,
  tier: string,
  idea: string,
) => event(ms, "session.launch", { agent, pane, role: "writer", tier, idea });

/** A cumulative token reading for a writer session in its pane. */
export const writerUsage = (
  ms: number,
  agent: string,
  pane: string,
  tokens: number,
) => event(ms, "token.usage", { agent, pane, tokens, source: "claude" });

/** The link event pr open writes: a pull request number and the writer session that opened it. */
export const linked = (ms: number, number: number, agent: string) =>
  event(ms, "pr.linked", { number, session: agent, agent });

/** Merged changes at the given times, numbered 100, 101, and so on in order. */
export const mergedAt = (...times: number[]) =>
  times.map((ms, i) => event(ms, "pr.merged", { number: 100 + i }));

export const ZERO_TIER = {
  sessions: 0,
  weightedTokens: 0,
  perMergedChange: 0,
  perMergedChangeByTier: null,
  mergedChanges: 0,
  followUpsPerSession: null,
  finished: 0,
  blocked: 0,
  blockedShare: null,
  perMergedChangeDollars: null,
};

export const ZERO_TIERS = {
  "claude-fable-5-2": ZERO_TIER,
  "claude-opus-5-5": ZERO_TIER,
  "claude-sonnet-5-5": ZERO_TIER,
  "claude-haiku-5-5": ZERO_TIER,
};

/** The orchestrating part of a span with no spend: its tokens, and its dollars at the assumed main-session model. */
export const NO_ORCHESTRATE = {
  weightedTokens: 0,
  perMergedChange: 0,
  model: "claude-opus-5-5",
  dollars: 0,
  dollarsPerMergedChange: 0,
};

/** A joined tier whose changes carry no spend: every part a dollar zero, not an unread null. */
export const ZERO_DOLLARS = {
  writer: 0,
  reviewer: 0,
  judge: 0,
  orchestrate: 0,
  allIn: 0,
  median: 0,
};

/** The judge's shared part of a span with no spend. */
export const NO_JUDGE = { dollars: 0, dollarsPerMergedChange: 0 };
