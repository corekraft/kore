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

const escape = (text: string): string =>
  text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/** A Bash pattern: `cmd:*` is a prefix on word boundaries, `*` matches anything. */
function bashRegex(body: string): RegExp {
  const prefix = body.endsWith(":*");
  const source = (prefix ? body.slice(0, -2) : body)
    .split("*")
    .map(escape)
    .join(".*");
  return new RegExp(`^${source}${prefix ? "(?: .*)?" : ""}$`);
}

/** A path pattern relative to the root: `**` crosses directories, `*` does not. */
function pathRegex(body: string): RegExp {
  const source = body
    .replace(/^\.\//, "")
    .split("**")
    .map((part) => part.split("*").map(escape).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${source}$`);
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
  return (tool === "Bash" ? bashRegex(body) : pathRegex(body)).test(subject);
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
