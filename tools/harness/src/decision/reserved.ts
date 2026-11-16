/**
 * The reserved list of ADR 0120: decisions that belong to the owner. The list is closed and
 * kept here with the advisor's tool; a question that matches any entry is never recorded as a
 * decision. The patterns are a backstop, not the boundary: a reworded question can miss them,
 * and a match that does not belong is routed to the owner rather than decided (fail closed).
 * They are placeholders (ADR 0120), and a change to this list is itself reserved.
 */

export interface ReservedCategory {
  /** The category's name, quoted in the refusal. */
  readonly category: string;
  /** What the category covers, in the words of ADR 0120. */
  readonly covers: string;
  readonly pattern: RegExp;
}

export const RESERVED_CATEGORIES: readonly ReservedCategory[] = [
  {
    category: "destruction",
    covers: "any destruction",
    pattern:
      /\b(delet\w*|destroy\w*|purge\w*|wipe\w*|prun\w*|tear(ing)? down|drop (the )?(table|database|cluster))\b|force[- ]push|reset --hard|rm -rf/i,
  },
  {
    category: "guardrail-mode",
    covers: "a guardrail's mode",
    pattern:
      /\bguardrails?\b.*\b(mode|enforce|audit)\b|\b(enforce|audit) mode\b|\bguardrail activate\b/i,
  },
  {
    category: "credentials",
    covers: "credentials and identities",
    pattern:
      /\b(credentials?|secrets?|tokens?|passwords?|api keys?|private keys?|age keys?|identit(y|ies))\b/i,
  },
  {
    category: "external-and-spend",
    covers:
      "accounts, external services, spend and any action outside the repository",
    pattern:
      /\b(accounts?|spend\w*|billing|paid|subscriptions?|third[- ]party|external services?|outside the repository)\b/i,
  },
  {
    category: "flag-activation",
    covers: "turning a flag on",
    pattern:
      /\bflag activate\b|\bflags?\b.*\b(on|true|activate\w*)\b|\b(activate|turn on|switch on|enable)\b.*\bflags?\b/i,
  },
  {
    category: "dispatch-and-merge",
    covers:
      "dispatching a release or a live workflow, and merging outside the four safe patterns",
    pattern:
      /\b(dispatch\w*|workflow_dispatch|release workflow|live workflow|live\.yml|nightly)\b|\bmerg(e|ing)\b.*(\bpr\b|pull request|#\d+)/i,
  },
  {
    category: "idea-approval",
    covers: "approving a non-harness idea",
    pattern: /\bapprov\w*\b.*\bideas?\b|\bideas?\b.*\bapprov\w*\b/i,
  },
  {
    category: "adr-reversal",
    covers: "reversing or superseding an accepted ADR",
    pattern:
      /\b(supersed\w*|revers\w*|overturn\w*|revert\w*)\b.*\badrs?\b|\badrs?\b.*\b(supersed\w*|revers\w*)\b/i,
  },
  {
    category: "parked",
    covers: "anything the owner has explicitly parked",
    pattern: /\bparked\b|\bpre-commit\b|#417\b/i,
  },
  {
    category: "advisor-own",
    covers:
      "the advisor's own definition, tier, reserved list, router, matcher and digest",
    pattern:
      /\badvisor\b.*\b(definitions?|tier|reserved list|router|matcher|digest)\b|\b(reserved list|matcher|digest)\b|agents\/advisor|decision\/reserved/i,
  },
];

/** The name of the first reserved category the text matches, or undefined when none does. */
export function reservedCategory(text: string): string | undefined {
  return RESERVED_CATEGORIES.find((entry) => entry.pattern.test(text))
    ?.category;
}
