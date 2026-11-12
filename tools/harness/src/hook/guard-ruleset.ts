// A declared ruleset (.github/rulesets/*.json) protects main, so an edit that
// removes a rule, loosens a parameter or adds a bypass actor weakens the guard,
// and a person approves that (ADR 0080, ADR 0090). Audit mode (warn).
import { weakenings } from "../ruleset/index.js";
import { warn, type Finding } from "./guard-verdict.js";

type Json = Record<string, unknown>;

export const RULESET_FILE = /^\.github\/rulesets\/[^/]+\.json$/;

const parse = (text: string): Json | undefined => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Json)
      : undefined;
  } catch {
    return undefined;
  }
};

function problemsOf(was: Json, now: Json): string[] {
  const { removed, weaker } = weakenings(was, now);
  return [...removed.map((type) => `rule ${type} is removed`), ...weaker];
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
      : problemsOf(was, now);
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
