// The guardrail inventory protects itself: an edit that turns an enforced rule
// into audit, or removes, narrows or renames a deny pattern, weakens the guard,
// and changing either needs a person's approval (ADR 0080). Audit mode (warn) until the owner approves enforcing it;
// promoting this rule is a one-line mode edit in the inventory.
import { INVENTORY_PATH } from "../guardrail/index.js";
import { writtenPath } from "./guard-append-only.js";
import { warn, type Finding } from "./guard-verdict.js";

type Input = Record<string, unknown>;

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

// A one-line entry: the rule name, then its mode.
const ENTRY =
  /"rule"\s*:\s*"([a-z0-9-]+)"[^}]*?"mode"\s*:\s*"(audit|enforce)"/g;
// A one-line entry as a whole, to read its deny patterns.
const OBJECT = /\{[^{}]*"rule"\s*:\s*"([a-z0-9-]+)"[^{}]*\}/g;
const DENY = /"deny"\s*:\s*\[([^\]]*)\]/;
const MODE = /"mode"\s*:\s*"(audit|enforce)"/g;

const modes = (source: string): Map<string, string> =>
  new Map(
    [...source.matchAll(ENTRY)].map((m) => [m[1] as string, m[2] as string]),
  );

/** Each rule's deny patterns; a rule without a deny list is absent. */
function denies(source: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [object, rule] of source.matchAll(OBJECT)) {
    const list = DENY.exec(object)?.[1];
    if (list !== undefined) {
      found.set(
        rule as string,
        [...list.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1] as string),
      );
    }
  }
  return found;
}

/**
 * Deny rules the change weakens: an entry removed or renamed, or a pattern it
 * no longer holds verbatim. A pattern that changed cannot be told narrower
 * from different, so it counts; adding a pattern does not.
 */
function weakened(previous: string, after: string): string[] {
  const now = denies(after);
  return [...denies(previous)]
    .filter(([rule, patterns]) => {
      const kept = now.get(rule);
      return kept === undefined || patterns.some((p) => !kept.includes(p));
    })
    .map(([rule]) => rule);
}

const count = (source: string, mode: string): number =>
  [...source.matchAll(MODE)].filter((m) => m[1] === mode).length;

/** Rules the change turns from enforce to audit; "a rule" when only a bare mode line changed. */
function demoted(previous: string, after: string): string[] {
  const was = modes(previous);
  const named = [...modes(after)]
    .filter(([rule, mode]) => mode === "audit" && was.get(rule) === "enforce")
    .map(([rule]) => rule);
  if (named.length > 0) {
    return named;
  }
  const unnamed = was.size === 0 && modes(after).size === 0;
  return unnamed &&
    count(after, "audit") > count(previous, "audit") &&
    count(previous, "enforce") > count(after, "enforce")
    ? ["a rule"]
    : [];
}

export function checkGuardrailDemotion(
  tool: string,
  input: Input,
  relative: string,
  previous: string,
): Finding {
  if (relative !== INVENTORY_PATH) {
    return null;
  }
  const after = text(tool === "Edit" ? input["new_string"] : input["content"]);
  const rules = demoted(previous, after);
  const weak = weakened(previous, after);
  if (rules.length === 0 && weak.length === 0) {
    return null;
  }
  const problems = [
    ...(rules.length > 0
      ? [`turns ${rules.join(", ")} from enforce to audit by hand`]
      : []),
    ...(weak.length > 0
      ? [
          `removes, narrows or renames the deny patterns of ${weak.join(", ")} by hand`,
        ]
      : []),
  ];
  return warn(
    "guardrail-demotion",
    `${relative} ${problems.join(" and ")}. A person approves a guardrail's mode and deny patterns (ADR 0080). ` +
      "Instead, leave them and ask the user to approve the change, or promote a rule from audit to enforce.",
  );
}

const INVENTORY_TARGET = /(^|[/\s>'"=])\.claude\/guardrails\.yaml$/;

/**
 * A Bash command that rewrites the inventory (sed -i, a redirect, tee, cp, mv).
 * A command's effect cannot be read, so any rewrite warns, not only a demotion.
 */
export function checkGuardrailBash(
  name: string,
  args: string[],
  segment: string[],
): Finding {
  const path = writtenPath(name, args, segment, (p) =>
    INVENTORY_TARGET.test(p),
  );
  return path === undefined
    ? null
    : warn(
        "guardrail-demotion",
        `${INVENTORY_PATH} is rewritten by a command, whose effect on each rule's mode cannot be checked. ` +
          "Instead, edit it with the Edit tool so a change from enforce to audit is checked, and leave demotions to a person (ADR 0080).",
      );
}
