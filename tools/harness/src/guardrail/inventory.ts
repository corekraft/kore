// The guardrail inventory: one declared list of the guard's rules, each with
// its kind, mode and owner. The guard reads a rule's mode from here, so a rule
// moves between warn and block by editing one line (ADR 0080).
// Plan: infra/plans/12-self-improving-loop.md (Step 4).

export const INVENTORY_PATH = ".claude/guardrails.yaml";

export const MODES = ["audit", "enforce"] as const;
export type Mode = (typeof MODES)[number];

/** What a rule inspects: Bash commands, file reads and writes, or both. */
export const KINDS = ["bash", "file", "bash-and-file"] as const;
export type GuardrailKind = (typeof KINDS)[number];

export interface Guardrail {
  rule: string;
  kind: GuardrailKind;
  mode: Mode;
  /** The module that implements the rule. */
  owner: string;
}

export interface Inventory {
  guardrails: readonly Guardrail[];
}

export class GuardrailError extends Error {}

/** The inventory file is absent, as opposed to present and invalid. */
export class MissingInventoryError extends GuardrailError {}

const FIELDS = ["rule", "kind", "mode", "owner"];
const RULE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const fail = (problem: string): never => {
  throw new GuardrailError(
    `${INVENTORY_PATH}: ${problem}. Fix the inventory, then rerun.`,
  );
};

function entry(raw: unknown, index: number): Guardrail {
  const where = `guardrails[${index}]`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail(`${where} must be an object`);
  }
  const fields = raw as Record<string, unknown>;
  for (const key of Object.keys(fields)) {
    if (!FIELDS.includes(key)) {
      fail(`${where} has an unknown field "${key}"`);
    }
  }
  const { rule, kind, mode, owner } = fields;
  if (typeof rule !== "string" || !RULE.test(rule)) {
    fail(`${where}.rule must be a lowercase kebab-case name`);
  }
  if (!KINDS.includes(kind as GuardrailKind)) {
    fail(`${where}.kind must be one of ${KINDS.join(", ")}`);
  }
  if (!MODES.includes(mode as Mode)) {
    fail(`${where}.mode must be audit or enforce`);
  }
  if (typeof owner !== "string" || owner.trim() === "") {
    fail(`${where}.owner must name the module that implements the rule`);
  }
  return fields as unknown as Guardrail;
}

/** Schema-checks the inventory text, which stays JSON-compatible YAML. */
export function parseInventory(text: string): Inventory {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail("is not JSON-compatible YAML");
  }
  const list =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)["guardrails"]
      : undefined;
  if (!Array.isArray(list)) {
    return fail('must be an object with a "guardrails" list');
  }
  const guardrails = list.map(entry);
  const seen = new Set<string>();
  for (const { rule } of guardrails) {
    if (seen.has(rule)) {
      fail(`${rule} must have exactly one entry, its owner's`);
    }
    seen.add(rule);
  }
  return { guardrails };
}

/** A rule's mode; a rule the inventory does not list enforces. */
export function modeOf(inventory: Inventory, rule: string): Mode {
  return inventory.guardrails.find((g) => g.rule === rule)?.mode ?? "enforce";
}

export function auditRuleNames(inventory: Inventory): string[] {
  return inventory.guardrails
    .filter((g) => g.mode === "audit")
    .map((g) => g.rule)
    .sort();
}
