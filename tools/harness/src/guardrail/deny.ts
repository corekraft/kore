// Deny rules in the inventory. Claude Code deny rules cannot warn, so the
// settings deny list is generated from the enforce rules only, and an audit
// deny rule becomes a guard warning (ADR 0080). The inventory is the one owner
// of the list; a hand edit of the generated list is drift.
// Plan: infra/plans/12-self-improving-loop.md (Step 4).
import { GuardrailError, type Inventory, type Mode } from "./inventory.js";

export interface DenyRule {
  rule: string;
  mode: Mode;
  patterns: readonly string[];
}

export function denyRules(inventory: Inventory): DenyRule[] {
  return inventory.guardrails.flatMap((g) =>
    g.deny === undefined
      ? []
      : [{ rule: g.rule, mode: g.mode, patterns: g.deny }],
  );
}

/** The settings deny list: every pattern of every enforced deny rule, in inventory order. */
export function denyList(inventory: Inventory): string[] {
  return denyRules(inventory)
    .filter((r) => r.mode === "enforce")
    .flatMap((r) => [...r.patterns]);
}

/** A pattern character, or a wildcard that may (or may not) cross a slash. */
type Item = { literal: string } | { crossesSlash: boolean };

/** Reads a pattern; `**` only has meaning in a path, where `*` stops at a slash. */
function items(pattern: string, path: boolean): Item[] {
  const found: Item[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern.charAt(i);
    if (char !== "*") {
      found.push({ literal: char });
    } else if (path && pattern.charAt(i + 1) === "*") {
      found.push({ crossesSlash: true });
      i++;
    } else {
      found.push({ crossesSlash: !path });
    }
  }
  return found;
}

/** Whether the whole text matches; no regular expression is built from the pattern. */
function matches(pattern: Item[], text: string): boolean {
  let row = Array.from({ length: text.length + 1 }, (_, j) => j === 0);
  for (const item of pattern) {
    const next = Array.from({ length: text.length + 1 }, () => false);
    for (let j = 0; j <= text.length; j++) {
      next[j] =
        "literal" in item
          ? j > 0 && row[j - 1] === true && text[j - 1] === item.literal
          : row[j] === true ||
            (j > 0 &&
              next[j - 1] === true &&
              (item.crossesSlash || text[j - 1] !== "/"));
    }
    row = next;
  }
  return row[text.length] === true;
}

/** A Bash pattern: `cmd:*` is a prefix on word boundaries, `*` matches anything. */
function bashMatches(body: string, command: string): boolean {
  if (!body.endsWith(":*")) {
    return matches(items(body, false), command);
  }
  const prefix = body.slice(0, -2);
  return (
    matches(items(prefix, false), command) ||
    matches(items(`${prefix} *`, false), command)
  );
}

/** Whether a permission pattern covers a call: a command, or a root-relative path. */
export function denyMatches(
  pattern: string,
  tool: string,
  subject: string,
): boolean {
  const open = pattern.indexOf("(");
  if (open < 0 || pattern.slice(0, open) !== tool || !pattern.endsWith(")")) {
    return false;
  }
  const body = pattern.slice(open + 1, -1);
  return tool === "Bash"
    ? bashMatches(body, subject)
    : matches(items(body.replace(/^\.\//, ""), true), subject);
}

function parseSettings(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new GuardrailError(
      ".claude/settings.json is not JSON. Restore it from git, then rerun.",
    );
  }
}

/** The deny patterns the settings hold today. */
export function settingsDeny(settingsText: string): string[] {
  const permissions = (
    parseSettings(settingsText) as { permissions?: { deny?: unknown } }
  ).permissions;
  return Array.isArray(permissions?.deny) ? (permissions.deny as string[]) : [];
}

/** Problems with the settings deny list against the generated one; none when it is untouched. */
export function denyDrift(
  inventory: Inventory,
  settingsText: string,
): string[] {
  const actual = settingsDeny(settingsText);
  const expected = denyList(inventory);
  const problems = [
    ...expected
      .filter((p) => !actual.includes(p))
      .map((p) => `${p} is missing from the settings deny list`),
    ...actual
      .filter((p) => !expected.includes(p))
      .map(
        (p) =>
          `${p} is in the settings deny list but not generated from an enforced inventory rule`,
      ),
  ];
  if (problems.length === 0 && actual.join("\n") !== expected.join("\n")) {
    problems.push("the settings deny list is in a different order");
  }
  return problems;
}

/** The settings text with its deny list replaced; every other key stays as it was. */
export function settingsWithDeny(settingsText: string, deny: string[]): string {
  const settings = parseSettings(settingsText) as {
    permissions?: Record<string, unknown>;
  };
  settings.permissions = { ...settings.permissions, deny };
  return `${JSON.stringify(settings, null, 2)}\n`;
}
