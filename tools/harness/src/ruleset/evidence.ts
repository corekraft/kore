import type { Runner } from "../runtime/index.js";
import { RulesetError, candidateName } from "./declared.js";
import { GitHubRulesets } from "./github.js";
import { PERIODS, summarize } from "./insights.js";

export interface RuleFirings {
  /** The candidate ruleset the firings were read from. */
  ruleset: string;
  timePeriod: string;
  /** Rule suites GitHub evaluated in the period. */
  suites: number;
  /** Suites where this rule, in evaluate mode, would have blocked. */
  firings: number;
  /** The period held more suites than one page; the counts are a floor. */
  truncated: boolean;
}

/** The GitHub rule type an inventory rule stands for, such as pull_request for main-ruleset-pull-request. */
function ruleType(rule: string, target: string): string {
  const prefix = `${target}-ruleset-`;
  if (!rule.startsWith(prefix)) {
    throw new RulesetError(
      `${rule} does not belong to the ${target} ruleset, whose rules are named ${prefix}<type>. Instead, pass the --target that owns it.`,
    );
  }
  return rule.slice(prefix.length).replaceAll("-", "_");
}

/**
 * How often one rule of the evaluate-mode candidate ruleset would have blocked
 * (`harness ruleset insights`, ADR 0090). Read-only.
 */
export async function ruleFirings(
  runner: Runner,
  subject: { repo: string; target: string; rule: string; timePeriod: string },
): Promise<RuleFirings> {
  const { repo, target, rule, timePeriod } = subject;
  if (!PERIODS.includes(timePeriod)) {
    throw new RulesetError(
      `--time-period ${timePeriod} is not one of ${PERIODS.join(", ")}. Rerun with --time-period <${PERIODS.join("|")}>.`,
    );
  }
  const type = ruleType(rule, target);
  const github = new GitHubRulesets(runner, repo);
  const ruleset = candidateName(target);
  const live = await github.find(ruleset);
  const result = await summarize(github, {
    repo,
    target,
    ruleset,
    targetId: typeof live?.["id"] === "number" ? live["id"] : undefined,
    timePeriod,
  });
  return {
    ruleset,
    timePeriod,
    suites: result.suites,
    firings: result.byRule[type] ?? 0,
    truncated: result.truncated,
  };
}
