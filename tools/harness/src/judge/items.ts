import type { Mode } from "../guardrail/index.js";
import type { Checks, CheckResult } from "./checks.js";

/** The inventory rule behind each judge checklist item (ADR 0080). */
export const ITEM_RULES = {
  ci: "judge-ci",
  scan: "judge-scan",
  coverage: "judge-coverage",
  principlesReview: "judge-principles-review",
  patternMatch: "judge-pattern-match",
} as const;

/** An audit-mode item that did not pass: reported, never a reason to send the change back. */
export interface Audited {
  rule: string;
  result: CheckResult | "mismatch";
  detail?: string;
}

/** Reads a rule's mode; a rule the inventory does not list enforces. */
export type ModeOf = (rule: string) => Mode;

export const enforcing: ModeOf = () => "enforce";

/**
 * Splits the failing checklist items by mode: an enforce item makes the report
 * not ok; an audit item is listed in `audited` and leaves `ok` alone.
 */
export function applyModes(
  checks: Checks,
  pattern: { matches: boolean; mismatch?: string },
  modeOf: ModeOf,
): { ok: boolean; audited: Audited[] } {
  const items: { rule: string; failed: Audited | undefined }[] = [
    ...(Object.keys(checks) as (keyof Checks)[]).map((key) => ({
      rule: ITEM_RULES[key],
      failed:
        checks[key].result === "pass"
          ? undefined
          : {
              rule: ITEM_RULES[key],
              result: checks[key].result,
              ...(checks[key].detail === undefined
                ? {}
                : { detail: checks[key].detail }),
            },
    })),
    {
      rule: ITEM_RULES.patternMatch,
      failed: pattern.matches
        ? undefined
        : {
            rule: ITEM_RULES.patternMatch,
            result: "mismatch",
            ...(pattern.mismatch === undefined
              ? {}
              : { detail: pattern.mismatch }),
          },
    },
  ];
  const failed = items.filter((i) => i.failed !== undefined);
  return {
    ok: failed.every((i) => modeOf(i.rule) === "audit"),
    audited: failed
      .filter((i) => modeOf(i.rule) === "audit")
      .map((i) => i.failed as Audited),
  };
}
