// A declared ruleset (.github/rulesets/*.json) protects main, so an edit that
// removes a rule, loosens a parameter or adds a bypass actor weakens the guard,
// and a person approves that (ADR 0080, ADR 0090). Audit mode (warn).
import { warn, type Finding } from "./guard-verdict.js";

type Json = Record<string, unknown>;

export const RULESET_FILE = /^\.github\/rulesets\/[^/]+\.json$/;

const object = (value: unknown): Json | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;

const parse = (text: string): Json | undefined => {
  try {
    return object(JSON.parse(text));
  } catch {
    return undefined;
  }
};

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Where a value got weaker: a key or element gone, a number lowered, or a
 * value changed. A changed boolean or string cannot be told stricter from
 * different, so it counts; a new key or element, or a higher number, does not.
 */
function weaker(was: unknown, now: unknown, path: string): string[] {
  if (Array.isArray(was)) {
    const kept = Array.isArray(now) ? (now as unknown[]) : [];
    return was
      .filter((item) => !kept.some((k) => same(k, item)))
      .map(() => `${path} loses an entry`);
  }
  const old = object(was);
  if (old !== undefined) {
    const next = object(now) ?? {};
    return Object.entries(old).flatMap(([key, value]) =>
      key in next
        ? weaker(value, next[key], `${path}.${key}`)
        : [`${path}.${key} is removed`],
    );
  }
  if (typeof was === "number" && typeof now === "number") {
    return now < was ? [`${path} is lowered`] : [];
  }
  return same(was, now) ? [] : [`${path} changes`];
}

const typed = (body: Json): Map<string, unknown> =>
  new Map(
    ((body["rules"] as Json[] | undefined) ?? []).map((r) => [
      String(r["type"]),
      r["parameters"] ?? null,
    ]),
  );

function weakenings(previous: Json, after: Json): string[] {
  const now = typed(after);
  const rules = [...typed(previous)].flatMap(([type, parameters]) =>
    now.has(type)
      ? weaker(parameters, now.get(type), type)
      : [`rule ${type} is removed`],
  );
  const conditions = same(previous["conditions"], after["conditions"])
    ? []
    : ["conditions change"];
  const had = (previous["bypass_actors"] as unknown[] | undefined) ?? [];
  const bypass = ((after["bypass_actors"] as unknown[] | undefined) ?? [])
    .filter((actor) => !had.some((h) => same(h, actor)))
    .map(() => "bypass_actors gains an actor");
  return [...rules, ...conditions, ...bypass];
}

/** Warns when a declared ruleset, as the change leaves it, is weaker than on disk. */
export function checkRulesetWeakening(
  relative: string,
  previous: string,
  after: string,
): Finding {
  if (!RULESET_FILE.test(relative)) {
    return null;
  }
  const was = parse(previous);
  if (was === undefined) {
    return null;
  }
  const now = parse(after);
  const problems =
    now === undefined
      ? ["is no longer a JSON object, so its rules cannot be checked"]
      : weakenings(was, now);
  return problems.length === 0
    ? null
    : warn(
        "guardrail-demotion",
        `${relative} weakens the declared ruleset by hand: ${problems.join("; ")}. A person approves a guardrail's rules (ADR 0080). ` +
          "Instead, leave them and ask the user to approve the change; a changed rule lands in audit mode in the candidate ruleset first.",
      );
}

/**
 * `ruleset sync --confirm` changes the live ruleset, which the operator
 * confirms first (AGENTS.md); a dry run mutates nothing and stays silent.
 */
export function checkRulesetSyncBash(name: string, args: string[]): Finding {
  const words = [name, ...args];
  const at = words.indexOf("ruleset");
  return at >= 0 && words[at + 1] === "sync" && words.includes("--confirm")
    ? warn(
        "guardrail-demotion",
        "ruleset sync --confirm changes the live GitHub ruleset. The operator confirms every live change first (AGENTS.md, ADR 0080). " +
          "Instead, run it with --dry-run and ask the user to confirm the planned change.",
      )
    : null;
}
