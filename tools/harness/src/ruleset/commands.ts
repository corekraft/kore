import type { Command, CommandContext } from "../runtime/index.js";
import { RulesetError, candidateName } from "./declared.js";
import { GitHubRulesets } from "./github.js";
import { PERIODS, summarize } from "./insights.js";
import { syncRuleset } from "./sync.js";
import { destination, guarded } from "./support.js";

async function ruleInsights(context: CommandContext): Promise<number> {
  const { deps, json } = context;
  const { repo, target } = destination(context);
  const given = context.options["time-period"];
  const period = typeof given === "string" ? given : "week";
  if (!PERIODS.includes(period)) {
    throw new RulesetError(
      `--time-period ${period} is not one of ${PERIODS.join(", ")}. Rerun with --time-period <${PERIODS.join("|")}>.`,
    );
  }
  const github = new GitHubRulesets(deps.runner, repo);
  // Evaluate firings happen in the candidate ruleset, never in main.
  const candidate = candidateName(target);
  const live = await github.find(candidate);
  const result = await summarize(github, {
    repo,
    target,
    ruleset: candidate,
    targetId: typeof live?.["id"] === "number" ? live["id"] : undefined,
    timePeriod: period,
  });

  if (json) {
    deps.stdout(`${JSON.stringify(result)}\n`);
    return 0;
  }
  const rules = Object.entries(result.byRule).map(
    ([rule, count]) => `  ${rule}\t${count}\n`,
  );
  deps.stdout(
    `Ruleset ${target} in ${repo}, last ${period}: ${result.firings} evaluate firings in ${result.suites} rule suites.\n${rules.join("")}${result.actors.length > 0 ? `Actors: ${result.actors.join(", ")}\n` : ""}${result.truncated ? "Truncated: more suites exist than one page; narrow --time-period.\n" : ""}`,
  );
  return 0;
}

const sync: Command = {
  summary:
    "sync a repository ruleset from .github/rulesets/<target>.json: main stays active with the enforce rules (one main-ruleset-<rule> inventory entry each), audit rules sync into <target>-candidate in evaluate; --dry-run shows the plan and mutates nothing; a live change needs --confirm after the operator agrees, and removing a rule from main needs --allow-removal (--repo <owner/name> --target <name> [--dry-run] [--confirm] [--allow-removal])",
  options: {
    repo: "string",
    target: "string",
    "dry-run": "boolean",
    confirm: "boolean",
    "allow-removal": "boolean",
  },
  run: (context) => guarded(context, () => syncRuleset(context)),
};

const insights: Command = {
  summary:
    "summarize what the evaluate-mode candidate ruleset would have blocked, by rule, from GitHub's rule-suite insights; read-only, for the activation request (--repo <owner/name> --target <name> [--time-period hour|day|week|month])",
  options: { repo: "string", target: "string", "time-period": "string" },
  run: (context) => guarded(context, () => ruleInsights(context)),
};

export const rulesetCommands: Record<string, Command> = { sync, insights };
