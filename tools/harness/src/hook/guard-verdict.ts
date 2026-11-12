import type { Mode } from "../guardrail/index.js";

/** What the guard decides about one tool call. */
export type Verdict =
  | { action: "allow" }
  | { action: "block" | "warn"; rule: string; message: string };

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
  /** A rule's mode from the guardrail inventory. */
  modeOf(rule: string): Mode;
}

/** A finding as its rule's mode decides it: enforce blocks, audit warns. */
export function applyMode<T extends Finding>(finding: T, ctx: GuardContext): T {
  if (finding === null) {
    return finding;
  }
  const action = ctx.modeOf(finding.rule) === "audit" ? "warn" : "block";
  return { ...finding, action };
}
