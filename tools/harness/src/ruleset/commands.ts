import type { Command, CommandContext, CommandHelp } from "../runtime/index.js";
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

/** The help record for `ruleset sync`: makes the live rulesets match the declared file, once confirmed. */
const syncHelp: CommandHelp = {
  purpose:
    "Makes the repository's GitHub rulesets match the declared file .github/rulesets/<target>.json. The enforce rules go to the live ruleset <target>, which stays active; the audit rules go to <target>-candidate in evaluate mode, so GitHub reports what they would block. It refuses a change that would weaken main unless --allow-removal is given. Each declared rule needs one main-ruleset-<rule> entry in the guardrail inventory; its mode decides whether it goes to main or to the candidate.",
  when: "After you edit .github/rulesets/<target>.json: preview with --dry-run, then apply with --confirm once the operator agrees to the plan.",
  whenNot:
    "To see what the candidate would have blocked: use ruleset insights. To move a rule from audit to enforce: a person approves it through guardrail request and guardrail activate, which edit the inventory; then sync.",
  flags: {
    repo: "The repository, as owner/name, such as corekraft/kore: the environment the ruleset is changed in. Required; never defaulted.",
    target:
      "The ruleset's name, which is also its file's name under .github/rulesets without .json, such as main. Required.",
    "dry-run":
      "Plans the change and prints the plan, sending nothing and taking no lock.",
    confirm:
      "Applies the planned change to GitHub. Without it a change is refused and nothing is sent.",
    "allow-removal":
      "Lets the change remove a rule from main or weaken one. Without it such a change is refused; use it only after the operator agrees.",
  },
  examples: [
    {
      command:
        "harness ruleset sync --repo corekraft/kore --target main --dry-run",
      shows:
        "the plan for main and main-candidate, what is added, changed or pending, with nothing sent; or no change when both already match",
    },
    {
      command:
        "harness ruleset sync --repo corekraft/kore --target main --confirm",
      shows:
        "the planned change sent to GitHub, then the plan that was applied; without --confirm the same change is refused",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "no change is needed, the dry run's plan is printed, or the change was applied with --confirm",
    },
    {
      code: 1,
      meaning:
        "refused and nothing was sent: a required flag is missing, the repository declares no such ruleset, the file names another ruleset, the change would weaken or remove a rule without --allow-removal, the change lacks --confirm, GitHub refuses evaluate on this plan, a gh call failed, or another sync holds the lock",
    },
    {
      code: 2,
      meaning: "a flag the command does not declare, or a flag with no value",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "with --confirm, creates or updates the rulesets <target> and <target>-candidate on GitHub through gh api, under a lock file in .kore/state/locks; the candidate is saved before main, so a refused evaluate leaves main untouched. Without --confirm, or with --dry-run, it changes nothing",
  },
  seeAlso: ["ruleset insights", "guardrail activate"],
};

const sync: Command = {
  summary:
    "sync the repository's rulesets from .github/rulesets; --dry-run plans, --confirm applies",
  options: {
    repo: "string",
    target: "string",
    "dry-run": "boolean",
    confirm: "boolean",
    "allow-removal": "boolean",
  },
  help: syncHelp,
  run: (context) => guarded(context, () => syncRuleset(context)),
};

/** The help record for `ruleset insights`: what the evaluate-mode candidate would have blocked. */
const insightsHelp: CommandHelp = {
  purpose:
    "Summarizes what the evaluate-mode candidate ruleset, <target>-candidate, would have blocked over a time period: the rule suites that fired, the rule types that fired and the actors. It reads GitHub's rule-suite insights and changes nothing.",
  when: "Before a guardrail request that moves a ruleset rule from audit to enforce, to read what the candidate blocked over the period.",
  whenNot:
    "To change a ruleset: use ruleset sync. To judge a guardrail rule over transcripts: use guardrail replay.",
  flags: {
    repo: "The repository, as owner/name, such as corekraft/kore. Required; never defaulted.",
    target:
      "The ruleset's name, such as main; the candidate read is <target>-candidate. Required.",
    "time-period":
      "The period GitHub summarizes: hour, day, week or month. Defaults to week.",
  },
  examples: [
    {
      command:
        "harness ruleset insights --repo corekraft/kore --target main --time-period week",
      shows:
        "a headline with the evaluate firings and rule suites for the week, then one line per rule type that fired, and the actors",
    },
    {
      command:
        "harness ruleset insights --repo corekraft/kore --target main --json",
      shows:
        "the same summary as one JSON object: repo, target, ruleset, timePeriod, suites, firings, byRule, actors and truncated",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the summary is printed; when the period holds more suites than one page the counts are a floor, and the output says so",
    },
    {
      code: 1,
      meaning:
        "refused: a required flag is missing, --time-period is not hour, day, week or month, or a GitHub read failed; stderr names the fix",
    },
    {
      code: 2,
      meaning: "a flag the command does not declare, or a flag with no value",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads the candidate ruleset and its rule suites from GitHub through gh api; writes nothing",
  },
  seeAlso: ["ruleset sync", "guardrail request"],
};

const insights: Command = {
  summary:
    "summarize what the evaluate-mode candidate ruleset would have blocked, by rule; read-only",
  options: { repo: "string", target: "string", "time-period": "string" },
  help: insightsHelp,
  run: (context) => guarded(context, () => ruleInsights(context)),
};

export const rulesetCommands: Record<string, Command> = { sync, insights };
