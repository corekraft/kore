import { readInventory, GuardrailError, modeOf } from "../guardrail/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import {
  DECLARED_DIR,
  RULE,
  RulesetError,
  parseDeclared,
  plan,
} from "./declared.js";
import { GitHubRulesets } from "./github.js";
import { PERIODS, summarize } from "./insights.js";

const FAILED = 1;

async function guarded(
  { json, deps }: CommandContext,
  action: () => Promise<number>,
): Promise<number> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof RulesetError || error instanceof GuardrailError)) {
      throw error;
    }
    deps.stderr(
      json
        ? `${JSON.stringify({ error: error.message })}\n`
        : `${error.message}\n`,
    );
    return FAILED;
  }
}

function required(context: CommandContext, key: string, meaning: string) {
  const value = context.options[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new RulesetError(
      `Missing --${key}: a ruleset change names its ${meaning} explicitly, never a default. Rerun with --${key} <value>.`,
    );
  }
  return value.trim();
}

/** The repository (the environment) and the ruleset name (the target) a command acts on. */
function destination(context: CommandContext) {
  return {
    repo: required(
      context,
      "repo",
      "repository, as owner/name, the environment",
    ),
    target: required(context, "target", "ruleset, by name, the target"),
  };
}

async function declaredBody(context: CommandContext, target: string) {
  const base = await context.deps.root();
  const path = `${DECLARED_DIR}/${target}.json`;
  let text: string;
  try {
    text = await context.deps.fs.readFile(`${base}/${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    throw new RulesetError(
      `The repository declares no ruleset "${target}" (no ${path}); it declares the rulesets under ${DECLARED_DIR}, such as main. Check --target.`,
    );
  }
  return { base, body: parseDeclared(path, text) };
}

async function syncRuleset(context: CommandContext): Promise<number> {
  const { deps, json } = context;
  const { repo, target } = destination(context);
  const dryRun = context.options["dry-run"] === true;
  const { base, body } = await declaredBody(context, target);
  const inventory = await readInventory((p) => deps.fs.readFile(p), base);
  if (!inventory.guardrails.some((g) => g.rule === RULE)) {
    throw new RulesetError(
      `The guardrail inventory has no ${RULE} rule, so the ruleset's mode is undeclared. Add it to .claude/guardrails.yaml, then rerun.`,
    );
  }
  const github = new GitHubRulesets(deps.runner, repo);
  const planned = plan(
    body,
    modeOf(inventory, RULE),
    await github.find(target),
  );
  const report = { repo, target, dryRun, ...planned, body: undefined };
  const move =
    planned.from === undefined
      ? `create as ${planned.enforcement}`
      : `${planned.from} -> ${planned.enforcement}`;
  if (planned.action === "none") {
    deps.stdout(
      json
        ? `${JSON.stringify(report)}\n`
        : `Ruleset ${target} in ${repo}: no change; already ${planned.enforcement}.\n`,
    );
    return 0;
  }
  if (!dryRun && context.options["confirm"] !== true) {
    throw new RulesetError(
      `Ruleset ${target} in ${repo} would change (${move}), but nothing was sent. Changing the live ruleset needs the operator's confirmation first: preview with --dry-run, then rerun with --confirm once the operator agrees.`,
    );
  }
  if (!dryRun) {
    await github.save(planned.id, planned.body);
  }
  const fields =
    planned.changed.length > 0 ? ` (also: ${planned.changed.join(", ")})` : "";
  const verb = dryRun
    ? `Dry run, nothing changed. Ruleset ${target} in ${repo} would change`
    : `Ruleset ${target} in ${repo} changed`;
  deps.stdout(
    json ? `${JSON.stringify(report)}\n` : `${verb}: ${move}${fields}.\n`,
  );
  return 0;
}

async function ruleInsights(context: CommandContext): Promise<number> {
  const { deps, json } = context;
  const { repo, target } = destination(context);
  const given = context.options["time-period"];
  const period = typeof given === "string" ? given : "week";
  if (!PERIODS.includes(period)) {
    throw new RulesetError(
      `--time-period ${period} is not one of ${PERIODS.join(", ")}.`,
    );
  }
  const github = new GitHubRulesets(deps.runner, repo);
  const live = await github.find(target);
  const result = await summarize(
    github,
    repo,
    target,
    typeof live?.["id"] === "number" ? live["id"] : undefined,
    period,
  );
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
    "sync a repository ruleset from .github/rulesets/<target>.json: the main-ruleset inventory mode sets enforcement (audit -> evaluate, enforce -> active); --dry-run shows the plan and mutates nothing; a live change needs --confirm after the operator agrees (--repo <owner/name> --target <name> [--dry-run] [--confirm])",
  options: {
    repo: "string",
    target: "string",
    "dry-run": "boolean",
    confirm: "boolean",
  },
  run: (context) => guarded(context, () => syncRuleset(context)),
};

const insights: Command = {
  summary:
    "summarize what an evaluate-mode ruleset would have blocked, by rule, from GitHub's rule-suite insights; read-only, for the activation request (--repo <owner/name> --target <name> [--time-period hour|day|week|month])",
  options: { repo: "string", target: "string", "time-period": "string" },
  run: (context) => guarded(context, () => ruleInsights(context)),
};

export const rulesetCommands: Record<string, Command> = { sync, insights };
