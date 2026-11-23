// Guard blocks per rule for the flow report (#984). Every known guard rule is a key from an empty ledger, so a
// harness idea can name its rule as a metric (ADR 0119).
import type { LedgerEvent } from "../ledger/index.js";
import type { Span } from "./intervals.js";
import { guardBlocks } from "./outcomes.js";

/**
 * The rules the guard hook can block or warn with, as .claude/guardrails.yaml names them. A deny rule is left out:
 * the settings enforce it and it writes no guard.block event. Kept in step with the inventory by hand.
 */
export const KNOWN_GUARD_RULES: readonly string[] = [
  "append-only",
  "bare-glob",
  "coverage-threshold",
  "destructive",
  "equals-word",
  "flag-activation",
  "guardrail-demotion",
  "helm-context",
  "idea-issue-body",
  "idea-issue-close",
  "idea-outcome",
  "image-digest",
  "kubectl-context",
  "no-verify",
  "role-no-merge",
  "role-read-only",
  "role-worktree",
  "secret-path",
  "sops-plaintext",
  "unquoted-glob",
];

/** Blocks per guard rule, by rule name. */
export type GuardBlocksByRule = Record<string, number>;

/**
 * Blocks per guard rule in the window: every known rule a key, zero where it never blocked, then any other rule the
 * ledger names, after the known ones in list order.
 */
export function guardBlocksByRule(
  events: LedgerEvent[],
  window: Span,
): GuardBlocksByRule {
  const counts: GuardBlocksByRule = Object.fromEntries(
    KNOWN_GUARD_RULES.map((rule) => [rule, 0]),
  );
  for (const { rule, blocks } of guardBlocks(events, window)) {
    counts[rule] = blocks;
  }
  return counts;
}
