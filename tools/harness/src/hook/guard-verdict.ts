import type { DenyRule, Mode } from "../guardrail/index.js";

/** What the guard decides about one tool call. */
export type Verdict =
  | { action: "allow" }
  | {
      action: "block" | "warn";
      rule: string;
      message: string;
      /** A joined warning: every rule it names, so each is recorded. */
      rules?: string[];
    };

/** A rule's decision to block or warn. */
export type Hit = Exclude<Verdict, { action: "allow" }>;

/** A rule's finding: absent when the rule has nothing to say. */
export type Finding = Hit | null;

export const block = (rule: string, message: string): Hit => ({
  action: "block",
  rule,
  message: `[guard:${rule}] ${message}`,
});

export const warn = (rule: string, message: string): Hit => ({
  action: "warn",
  rule,
  message: `[guard:${rule}] ${message}`,
});

export const allow: Verdict = { action: "allow" };

/** What the rules may read: the repository root, its files, and each rule's mode. */
export interface GuardContext {
  root: string;
  readFile(path: string): Promise<string>;
  /** Whether any path under the root matches a shell glob; the bare-glob rule reads it. */
  globMatches(pattern: string): Promise<boolean>;
  /** A rule's mode from the guardrail inventory. */
  modeOf(rule: string): Mode;
  /** The inventory's deny rules; those in audit mode warn here, since a settings deny cannot. */
  denyRules: readonly DenyRule[];
}

/** A finding as its rule's mode decides it: enforce blocks, audit warns. */
export function applyMode<T extends Finding>(finding: T, ctx: GuardContext): T {
  if (finding === null) {
    return finding;
  }
  const action = ctx.modeOf(finding.rule) === "audit" ? "warn" : "block";
  return { ...finding, action };
}

/**
 * Weighs findings that already carry their rule's mode: the first block wins;
 * otherwise every warning is joined, one per rule, into one verdict.
 */
export function weigh(findings: readonly Finding[]): Verdict {
  const hits = findings.filter((finding): finding is Hit => finding !== null);
  const blocked = hits.find((hit) => hit.action === "block");
  if (blocked) {
    return blocked;
  }
  const warnings = hits.filter(
    (hit, index) => hits.findIndex((h) => h.rule === hit.rule) === index,
  );
  const [first] = warnings;
  if (first === undefined) {
    return allow;
  }
  return {
    ...first,
    message: warnings.map((hit) => hit.message).join("\n"),
    rules: warnings.map((hit) => hit.rule),
  };
}
