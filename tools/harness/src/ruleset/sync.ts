import { modeOf, readInventory } from "../guardrail/index.js";
import type { Mode } from "../guardrail/index.js";
import type { CommandContext } from "../runtime/index.js";
import {
  DECLARED_DIR,
  RulesetError,
  candidateName,
  parseDeclared,
  planCandidate,
  planMain,
  ruleName,
  stage,
  typesOf,
  type CandidatePlan,
  type Json,
  type MainPlan,
} from "./declared.js";
import { GitHubError, GitHubRulesets } from "./github.js";
import { destination } from "./support.js";
import { weakenings } from "./weaken.js";
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
  const body = parseDeclared(path, text);
  if (body["name"] !== target) {
    throw new RulesetError(
      `${path} names the ruleset "${String(body["name"])}" but --target is ${target}, and a sync never renames a live ruleset. Fix the "name" in ${path} to ${target}, or pass the matching --target.`,
    );
  }
  return { base, body };
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
  const parts = [
    main.added.length > 0 ? `added: ${main.added.join(", ")}` : "",
    main.removed.length > 0
      ? `removed: ${main.removed.join(", ")} (needs --allow-removal)`
      : "",
    main.weakened.length > 0
      ? `weakened: ${main.weakened.join(", ")} (needs --allow-removal)`
      : "",
    main.changed.length > 0 ? `changed: ${main.changed.join(", ")}` : "",
    main.pending.length > 0
      ? `pending: ${main.pending.join(", ")} (in ${candidate.name} until observed)`
      : "",
  ].filter((part) => part !== "");
  const head =
    main.action === "none"
      ? "main: no change"
      : `main: ${main.action} (${main.from ?? "new"} -> active)`;
  const cand =
    candidate.action === "none"
      ? `${candidate.name}: no change`
      : `${candidate.name}: ${candidate.action} (evaluate); rules: ${candidate.rules.join(", ") || "none"}`;
  return `  ${[head, ...parts].join("; ")}\n  ${cand}\n`;
}

/**
 * How the declared file leaves main weaker than live: the enforce rules as
 * declared, plus live's version of an audit rule, which waits in the candidate.
 */
function weakened(
  body: Json,
  modes: (type: string) => Mode,
  live: Json | undefined,
): string[] {
  if (live === undefined) {
    return [];
  }
  const kept = ((live["rules"] as Json[] | undefined) ?? []).filter(
    (r) => modes(String(r["type"])) === "audit",
  );
  const declared = (body["rules"] as Json[]).filter(
    (r) => modes(String(r["type"])) === "enforce",
  );
  return weakenings(live, { ...body, rules: [...declared, ...kept] }).weaker;
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
    const liveMain = await github.find(target);
    const liveCandidate = await github.find(candidateName(target));
    const staged = stage(body, modes, liveMain, liveCandidate);
    const main = planMain(body, staged, liveMain);
    main.weakened = weakened(body, modes, liveMain);
    const candidate = planCandidate(body, staged.candidate, liveCandidate);
    const refused =
      (main.removed.length > 0 || main.weakened.length > 0) && !allowRemoval;
    const report = {
      repo,
      target,
      dryRun,
      refused,
      main: { ...main, body: undefined },
      candidate: { ...candidate, body: undefined },
    };
    const head = `Ruleset ${target} in ${repo}`;
    if (main.action === "none" && candidate.action === "none" && !refused) {
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
    if (refused) {
      const problems = [
        ...(main.removed.length > 0
          ? [`removes ${main.removed.join(", ")}`]
          : []),
        ...main.weakened,
      ];
      throw new RulesetError(
        `${head} would weaken main (${problems.join("; ")}), so nothing was sent. Instead, restore it in ${DECLARED_DIR}/${target}.json, or rerun with --allow-removal once the operator agrees.`,
      );
    }
    if (context.options["confirm"] !== true) {
      throw new RulesetError(
        `${head} would change, but nothing was sent. Changing the live ruleset needs the operator's confirmation first:\n${describe(main, candidate)}Preview with --dry-run, then rerun with --confirm once the operator agrees.`,
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
