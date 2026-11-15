import { join, resolve } from "node:path";
import { HARNESS_CONFIG, parseHarnessConfig } from "../flow/index.js";
import { DEFAULT_LEDGER, Ledger } from "../ledger/index.js";
import { bundleMainRoot, type CommandContext } from "../runtime/index.js";
import { GuardrailError, readInventory } from "../guardrail/index.js";
import {
  JudgeError,
  applyChecklist,
  modesFrom,
  precheck,
  reviewersFor,
  type ItemModes,
  type Report,
} from "../judge/index.js";

export const FAILED = 1;

export function prNumber(operand: string | undefined, usage: string): number {
  if (operand === undefined || !/^\d+$/.test(operand) || Number(operand) < 1) {
    throw new JudgeError(`Missing or invalid PR number. ${usage}`);
  }
  return Number(operand);
}

/**
 * The shared ledger of the checkout that holds this bundle. The judge may not choose it:
 * KORE_ROOT, CLAUDE_PROJECT_DIR and any --ledger are ignored or refused.
 */
export async function openJudgeLedger({
  deps,
}: CommandContext): Promise<Ledger> {
  const main = await bundleMainRoot(deps);
  if (main === undefined) {
    throw new JudgeError(
      "Cannot find the main checkout from the harness bundle's location, so there is no ledger to record to. Run the built skills/bin/harness.mjs (mise run harness-build) from inside the repository.",
    );
  }
  return new Ledger(
    deps.fs,
    deps.clock,
    deps.ids,
    resolve(main, DEFAULT_LEDGER),
  );
}

/**
 * Each checklist item's mode, from the inventory of the main checkout that holds this
 * bundle. The judge may not choose it: an unreadable inventory is refused, never read as
 * every item enforcing.
 */
export async function checklistModes({
  deps,
}: CommandContext): Promise<ItemModes> {
  const main = await bundleMainRoot(deps);
  if (main === undefined) {
    throw new JudgeError(
      "Cannot find the main checkout from the harness bundle's location, so there is no guardrail inventory to read checklist modes from. Run the built skills/bin/harness.mjs (mise run harness-build) from inside the repository.",
    );
  }
  try {
    return modesFrom(
      await readInventory((path) => deps.fs.readFile(path), main),
    );
  } catch (error) {
    if (error instanceof GuardrailError) {
      throw new JudgeError(
        `${error.message} The judge reads each checklist item's mode from the inventory; fix it, then rerun.`,
      );
    }
    throw error;
  }
}

/** The precheck under the checklist's modes; the modes are read first, so a refused inventory reads no PR. */
export async function checkedPrecheck(
  context: CommandContext,
  root: string,
  repo: string,
  pr: number,
  reviewers: readonly string[],
): Promise<Report> {
  const modes = await checklistModes(context);
  return applyChecklist(
    await precheck(context, root, repo, pr, reviewers),
    modes,
  );
}

/**
 * Writes one guard.audit ledger event for each audit item that failed. A firing is an
 * item at a head: a rerun at the same head writes nothing more.
 */
async function recordAudits(
  context: CommandContext,
  ledger: Ledger,
  report: Report,
): Promise<void> {
  const failing = report.audited ?? [];
  if (failing.length === 0 || report.head === undefined) {
    return;
  }
  const logged = new Set(
    (await ledger.list({ kind: "guard.audit" })).events.map((e) => e.id),
  );
  const idea = report.idea;
  for (const { rule } of failing) {
    const id = `judge.audit:${report.pr}:${report.head}:${rule}`;
    if (logged.has(id)) {
      continue;
    }
    const event = await ledger.record({
      source: "github",
      kind: "guard.audit",
      occurredAt: context.deps.clock.now().toISOString(),
      label: rule,
      id,
      ...(idea !== undefined && /^[\w.:/#@-]{1,128}$/.test(idea)
        ? { idea }
        : {}),
    });
    if (!event.ok) {
      throw new JudgeError(
        `The precheck ran, but the ledger event for audit item ${rule} was rejected: ${event.message} Fix the ledger, then rerun \`harness judge precheck ${report.pr}\`.`,
      );
    }
  }
}

/** Records the verdict, and the audit items that fired, at the shared ledger. */
export async function record(
  context: CommandContext,
  report: Report,
): Promise<void> {
  const ledger = await openJudgeLedger(context);
  await recordVerdict(context, ledger, report);
  await recordAudits(context, ledger, report);
}

async function recordVerdict(
  context: CommandContext,
  ledger: Ledger,
  report: Report,
): Promise<void> {
  const { deps } = context;
  const idea = report.idea;
  const label = `${report.pattern ?? "none"}:${report.ok ? "pass" : "fail"}`;
  const logged = await ledger.list({ kind: "precheck" });
  const newest = logged.events.filter((e) => e.number === report.pr).at(-1);
  // Only a change from the PR's newest verdict is news; pass, fail, pass records all three.
  if (newest?.label === label) {
    return;
  }
  const event = await ledger.record({
    source: "github",
    kind: "precheck",
    occurredAt: deps.clock.now().toISOString(),
    number: report.pr,
    label,
    ...(idea !== undefined && /^[\w.:/#@-]{1,128}$/.test(idea) ? { idea } : {}),
  });
  if (!event.ok) {
    throw new JudgeError(
      `The precheck ran, but its ledger event was rejected: ${event.message} Fix the ledger, then rerun \`harness judge precheck ${report.pr}\`.`,
    );
  }
}

const ownerOf = (repo: string): string => repo.split("/")[0] ?? repo;

/**
 * The logins the judge trusts for principles-review verdicts. --reviewer overrides everything and
 * the harness config is not read; otherwise reviewerLogins from the config, else its owner login,
 * else the repository's owner. The config is read from the main checkout, never the working
 * directory, so a judge run elsewhere cannot widen whom it trusts.
 */
export async function reviewersOf(
  context: CommandContext,
  repo: string,
): Promise<string[]> {
  const { deps } = context;
  const flag = context.options["reviewer"];
  if (flag !== undefined) {
    return reviewersFor({ flag: String(flag), owner: ownerOf(repo) });
  }
  const main = await bundleMainRoot(deps);
  if (main === undefined) {
    throw new JudgeError(
      "Cannot find the main checkout from the harness bundle's location, so there is no harness config to read reviewers from. Run the built skills/bin/harness.mjs (mise run harness-build) from inside the repository, or pass --reviewer <login>.",
    );
  }
  const file = join(main, HARNESS_CONFIG);
  const config = (await deps.fs.exists(file))
    ? parseHarnessConfig(await deps.fs.readFile(file), HARNESS_CONFIG)
    : undefined;
  if (config !== undefined && "error" in config) {
    throw new JudgeError(
      `${config.error} The judge reads whom to trust from this file; fix it, or pass --reviewer <login>.`,
    );
  }
  return reviewersFor({
    configured: config?.reviewerLogins,
    owner: config?.ownerLogin ?? ownerOf(repo),
  });
}

/** Reports an expected judge failure on stderr and returns the failing exit code; rethrows anything else. */
export function failed(context: CommandContext, error: unknown): number {
  if (!(error instanceof JudgeError)) {
    throw error;
  }
  context.deps.stderr(
    `${context.json ? `${JSON.stringify({ error: error.message })}\n` : ""}${error.message}\n`,
  );
  return FAILED;
}

const REMOTE = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/;

/**
 * The `owner/name` every gh call names, read from the origin remote of the checkout that
 * holds this bundle. Never GH_REPO and never the working directory: a judge run from
 * another checkout or with a stray GH_REPO still acts on the repository it was built in.
 */
export async function repoOf({ deps }: CommandContext): Promise<string> {
  const main = await bundleMainRoot(deps);
  if (main === undefined) {
    throw new JudgeError(
      "Cannot find the main checkout from the harness bundle's location, so there is no repository to name. Run the built skills/bin/harness.mjs (mise run harness-build) from inside the repository.",
    );
  }
  const done = await deps.runner.run("git", ["remote", "get-url", "origin"], {
    cwd: main,
  });
  const repo = REMOTE.exec(done.stdout.trim())?.[1];
  if (done.code !== 0 || repo === undefined) {
    throw new JudgeError(
      `The main checkout's origin remote is not a GitHub repository (${done.stdout.trim() || done.stderr.trim() || "no origin"}). Set it with \`git remote set-url origin <url>\`, then rerun.`,
    );
  }
  return repo;
}
