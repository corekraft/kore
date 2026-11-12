import { PAGE, type GitHubRulesets } from "./github.js";

type Json = Record<string, unknown>;

export const PERIODS = ["hour", "day", "week", "month"];

export interface Insights {
  repo: string;
  target: string;
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
  repo: string,
  target: string,
  targetId: number | undefined,
  timePeriod: string,
): Promise<Insights> {
  const suites = await github.suites(timePeriod);
  const failing = suites.filter((s) => s["evaluation_result"] === "fail");
  const byRule: Record<string, number> = {};
  const actors = new Set<string>();
  let firings = 0;
  for (const suite of failing) {
    const detail = await github.suite(suite["id"] as number);
    const fired = ((detail["rule_evaluations"] as Json[] | undefined) ?? [])
      .filter((e) => {
        const source = e["rule_source"] as Json | undefined;
        return (
          e["enforcement"] === "evaluate" &&
          e["result"] === "fail" &&
          (targetId === undefined
            ? source?.["name"] === target
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
    timePeriod,
    suites: suites.length,
    firings,
    byRule,
    actors: [...actors].sort(),
    truncated: suites.length >= PAGE,
  };
}
