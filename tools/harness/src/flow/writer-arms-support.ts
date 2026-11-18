// Fixtures the writer arms specs share: a writer launch (randomized unless a reason says otherwise),
// token readings, labels, results and the merged-change scenario they read.

import type { LedgerEvent } from "../ledger/index.js";
import {
  event,
  HAIKU,
  SONNET,
  linked,
  mergedAt,
} from "./writer-cost-support.js";

export const MINUTE = 60_000;
export const SPAN: [number, number] = [0, 100 * MINUTE];
export const OPUS = "claude-opus-5-5";
export const MYSTERY = "claude-mystery-9";

export const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** A writer launch; randomized (drawn Sonnet or control Haiku) unless a reason says otherwise. */
export const writer = (
  ms: number,
  agent: string,
  tier: string,
  effort?: string,
  tierReason: string | null = tier === SONNET
    ? "experiment"
    : "experiment-control",
): LedgerEvent =>
  event(ms, "session.launch", {
    agent,
    pane: `w:${agent}`,
    role: "writer",
    tier,
    ...(effort === undefined ? {} : { effort }),
    ...(tierReason === null ? {} : { tierReason }),
  });

/** A session's cumulative input tokens on one model, read at a time (a token.split reading). */
export const input = (
  ms: number,
  agent: string,
  model: string,
  tokens: number,
) =>
  event(ms, "token.split", {
    agent,
    model,
    lowInput: tokens,
    lowCacheWrite5m: 0,
    lowCacheWrite1h: 0,
    lowCacheRead: 0,
    lowOutput: 0,
    lowRequests: 1,
    highRequests: 0,
    highInput: 0,
    highCacheWrite5m: 0,
    highCacheWrite1h: 0,
    highCacheRead: 0,
    highOutput: 0,
  });

export const labelled = (agent: string, label: string) =>
  event(0, "session.labelled", { session: agent, label });

export const result = (
  ms: number,
  agent: string,
  outcome: "done" | "blocked",
) => event(ms, "session.result", { agent, result: outcome });

export const sendBack = (ms: number, number: number) =>
  event(ms, "send-back", { number });

export const ownerAction = (ms: number, number: number) =>
  event(ms, "owner.action", { number });

// Five merged changes on the arms, and one on an Opus writer that is in neither arm.
//   PR 100: Haiku writer h1 (high), label enhancement, 1M input tokens  -> $0.10
//   PR 101: Haiku writer h2 (high), label harness,     3M input tokens  -> $0.30
//   PR 102: Sonnet writer s1 (high), label enhancement, 2M tokens      -> $4.00
//   PR 103: Sonnet writer s2 (high), label harness,    1M tokens      -> $2.00
//   PR 104: Sonnet writer s3 (high), no label, 1M tokens               -> $2.00
//   PR 105: Opus writer o1, hand-picked, label harness, 1M tokens: in neither arm.
// Every arm launch is randomized at high, so the window effort is high with no setting given.
export const SCENARIO: LedgerEvent[] = [
  writer(1 * MINUTE, "h1-writer", HAIKU, "high"),
  writer(1 * MINUTE, "h2-writer", HAIKU, "high"),
  writer(1 * MINUTE, "s1-writer", SONNET, "high"),
  writer(1 * MINUTE, "s2-writer", SONNET, "high"),
  writer(1 * MINUTE, "s3-writer", SONNET, "high"),
  writer(1 * MINUTE, "o1-writer", OPUS, "high", null),
  labelled("h1-writer", "enhancement"),
  labelled("h2-writer", "harness"),
  labelled("s1-writer", "enhancement"),
  labelled("s2-writer", "harness"),
  labelled("o1-writer", "harness"),
  input(50 * MINUTE, "h1-writer", HAIKU, 1_000_000),
  input(50 * MINUTE, "h2-writer", HAIKU, 3_000_000),
  input(50 * MINUTE, "s1-writer", SONNET, 2_000_000),
  input(50 * MINUTE, "s2-writer", SONNET, 1_000_000),
  input(50 * MINUTE, "s3-writer", SONNET, 1_000_000),
  input(50 * MINUTE, "o1-writer", OPUS, 1_000_000),
  linked(55 * MINUTE, 100, "h1-writer"),
  linked(55 * MINUTE, 101, "h2-writer"),
  linked(55 * MINUTE, 102, "s1-writer"),
  linked(55 * MINUTE, 103, "s2-writer"),
  linked(55 * MINUTE, 104, "s3-writer"),
  linked(55 * MINUTE, 105, "o1-writer"),
  ...mergedAt(
    60 * MINUTE,
    70 * MINUTE,
    80 * MINUTE,
    90 * MINUTE,
    95 * MINUTE,
    97 * MINUTE,
  ),
  result(62 * MINUTE, "h1-writer", "blocked"),
  result(72 * MINUTE, "h2-writer", "done"),
  result(82 * MINUTE, "s1-writer", "done"),
  result(92 * MINUTE, "s2-writer", "blocked"),
  result(96 * MINUTE, "s3-writer", "done"),
  sendBack(61 * MINUTE, 100),
  sendBack(91 * MINUTE, 103),
  ownerAction(61 * MINUTE, 100),
  ownerAction(62 * MINUTE, 100),
  ownerAction(85 * MINUTE, 103),
  ownerAction(88 * MINUTE, 103),
];
