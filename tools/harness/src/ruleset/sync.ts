import { modeOf, readInventory } from "../guardrail/index.js";
import type { CommandContext } from "../runtime/index.js";
import {
  DECLARED_DIR,
  RulesetError,
  candidateName,
  parseDeclared,
  planCandidate,
  planMain,
  ruleName,
  split,
  typesOf,
  type CandidatePlan,
  type Json,
  type MainPlan,
} from "./declared.js";
import { GitHubError, GitHubRulesets } from "./github.js";
import { destination } from "./support.js";
import { withLock } from "./lock.js";

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

/** The modes of the declared rules, one inventory entry each; a rule with no entry has no declared mode. */
async function modesOf(context: CommandContext, base: string, body: Json) {
  const { deps } = context;
  const inventory = await readInventory((p) => deps.fs.readFile(p), base);
  const target = String(body["name"]);
  const listed = new Set(inventory.guardrails.map((g) => g.rule));
  for (const type of typesOf(body["rules"] as Json[])) {
    if (!listed.has(ruleName(target, type))) {
      throw new RulesetError(
        `The guardrail inventory has no ${ruleName(target, type)} rule, so the mode of the ${type} rule is undeclared. Add it to .claude/guardrails.yaml (enforce if main already has the rule live, else audit), then rerun.`,
      );
    }
  }
  return (type: string) => modeOf(inventory, ruleName(target, type));
}

function describe(main: MainPlan, candidate: CandidatePlan): string {
  const main_ =
    main.action === "none"
      ? "main: no change"
      : `main: ${main.action} (${main.from ?? "new"} -> active)` +
        (main.added.length > 0 ? `; added: ${main.added.join(", ")}` : "") +
        (main.removed.length > 0
          ? `; removed: ${main.removed.join(", ")} (needs --allow-removal)`
          : "") +
        (main.changed.length > 0
          ? `; changed: ${main.changed.join(", ")}`
          : "");
  const cand =
    candidate.action === "none"
      ? `${candidate.name}: no change`
      : `${candidate.name}: ${candidate.action} (evaluate); rules: ${candidate.rules.join(", ") || "none"}`;
  return `  ${main_}\n  ${cand}\n`;
}

/** GitHub says the plan has no evaluate mode: stop rather than guess. */
function evaluateRefused(error: unknown, name: string, repo: string): never {
  if (
    error instanceof GitHubError &&
    /\b422\b/.test(error.stderr) &&
    /enterprise|evaluate/i.test(error.stderr)
  ) {
    throw new RulesetError(
      `GitHub refused evaluate enforcement for ${name} in ${repo} (${error.stderr.trim()}): evaluate is unavailable on this plan. Nothing was changed. Ask the operator how to activate audit rules without evaluate; main stays active meanwhile.`,
    );
  }
  throw error;
}

async function apply(
  github: GitHubRulesets,
  main: MainPlan,
  candidate: CandidatePlan,
  repo: string,
): Promise<void> {
  // The candidate goes first: if evaluate is refused, main has not been touched.
  if (candidate.action !== "none") {
    await github
      .save(candidate.id, candidate.body)
      .catch((error: unknown) => evaluateRefused(error, candidate.name, repo));
  }
  if (main.action !== "none") {
    await github.save(main.id, main.body);
  }
}

export async function syncRuleset(context: CommandContext): Promise<number> {
  const { deps, json } = context;
  const { repo, target } = destination(context);
  const dryRun = context.options["dry-run"] === true;
  const allowRemoval = context.options["allow-removal"] === true;
  const { base, body } = await declaredBody(context, target);
  const modes = await modesOf(context, base, body);
  const github = new GitHubRulesets(deps.runner, repo);

  const work = async (): Promise<number> => {
    const { enforced, audited } = split(body, modes);
    const main = planMain(body, enforced, await github.find(target));
    const candidate = planCandidate(
      body,
      audited,
      await github.find(candidateName(target)),
    );
    const refused = main.removed.length > 0 && !allowRemoval;
    const report = {
      repo,
      target,
      dryRun,
      refused,
      main: { ...main, body: undefined },
      candidate: { ...candidate, body: undefined },
    };
    const head = `Ruleset ${target} in ${repo}`;
    if (main.action === "none" && candidate.action === "none") {
      deps.stdout(
        json
          ? `${JSON.stringify(report)}\n`
          : `${head}: no change; main is active and the candidate matches.\n`,
      );
      return 0;
    }
    if (dryRun) {
      deps.stdout(
        json
          ? `${JSON.stringify(report)}\n`
          : `${head}: dry run, nothing changed. Planned:\n${describe(main, candidate)}`,
      );
      return 0;
    }
    if (context.options["confirm"] !== true) {
      throw new RulesetError(
        `${head} would change, but nothing was sent. Changing the live ruleset needs the operator's confirmation first:\n${describe(main, candidate)}Preview with --dry-run, then rerun with --confirm once the operator agrees.`,
      );
    }
    if (refused) {
      throw new RulesetError(
        `${head} would remove ${main.removed.join(", ")} from main, which weakens it, so nothing was sent. Instead, add the rule back to ${DECLARED_DIR}/${target}.json, or rerun with --allow-removal once the operator agrees.`,
      );
    }
    await apply(github, main, candidate, repo);
    deps.stdout(
      json
        ? `${JSON.stringify(report)}\n`
        : `${head} changed:\n${describe(main, candidate)}`,
    );
    return 0;
  };
  // A dry run mutates nothing, so it takes no lock; a change plans and saves under it.
  return dryRun ? await work() : await withLock(deps, repo, work);
}
