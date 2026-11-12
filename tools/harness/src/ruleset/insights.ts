import { RulesetError } from "./declared.js";
import { PAGE, type GitHubRulesets } from "./github.js";

type Json = Record<string, unknown>;

export const PERIODS = ["hour", "day", "week", "month"];

/** What to summarize: the candidate ruleset (by name, and id when GitHub has it) of one target. */
export interface Subject {
  repo: string;
  target: string;
  ruleset: string;
  targetId: number | undefined;
  timePeriod: string;
}

export interface Insights {
  repo: string;
  target: string;
  /** The candidate ruleset the firings were read from. */
  ruleset: string;
  timePeriod: string;
  /** Rule suites GitHub evaluated in the period. */
  suites: number;
  /** Suites where the target ruleset, in evaluate mode, would have blocked. */
  firings: number;
  byRule: Record<string, number>;
  actors: string[];
  /** The period held more suites than one page; the counts are a floor. */
  truncated: boolean;
}

/**
 * Summarizes what the evaluate-mode ruleset would have blocked, for the
 * activation request (ADR 0080). Only suites GitHub flags as failing in
 * evaluation are fetched in full, since the list omits which rule fired.
 */
export async function summarize(
  github: GitHubRulesets,
  { repo, target, ruleset, targetId, timePeriod }: Subject,
): Promise<Insights> {
  const suites = await github.suites(timePeriod);
  const failing = suites.filter((s) => s["evaluation_result"] === "fail");
  const byRule: Record<string, number> = {};
  const actors = new Set<string>();
  let firings = 0;
  for (const suite of failing) {
    const id = suite["id"];
    if (typeof id !== "number") {
      throw new RulesetError(
        "GitHub listed a rule suite without a numeric id, so its rules cannot be read. Check `gh --version`, then rerun.",
      );
    }
    const detail = await github.suite(id);
    const fired = ((detail["rule_evaluations"] as Json[] | undefined) ?? [])
      .filter((e) => {
        const source = e["rule_source"] as Json | undefined;
        return (
          e["enforcement"] === "evaluate" &&
          e["result"] === "fail" &&
          (targetId === undefined
            ? source?.["name"] === ruleset
            : source?.["id"] === targetId)
        );
      })
      .map((e) => e["rule_type"] as string);
    if (fired.length === 0) {
      continue;
    }
    firings += 1;
    for (const type of new Set(fired)) {
      byRule[type] = (byRule[type] ?? 0) + 1;
    }
    if (typeof suite["actor_name"] === "string") {
      actors.add(suite["actor_name"]);
    }
  }
  return {
    repo,
    target,
    ruleset,
    timePeriod,
    suites: suites.length,
    firings,
    byRule,
    actors: [...actors].sort(),
    truncated: suites.length >= PAGE,
  };
}
