import { resolve } from "node:path";
import { DEFAULT_LEDGER, Ledger } from "../ledger/index.js";
import { bundleMainRoot, type CommandContext } from "../runtime/index.js";
import { JudgeError, type Report } from "../judge/index.js";

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

export async function record(
  context: CommandContext,
  report: Report,
): Promise<void> {
  const ledger = await openJudgeLedger(context);
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

/** The reviewers named with --reviewer, split on commas. */
export const reviewersOf = (context: CommandContext): string[] =>
  String(context.options["reviewer"] ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r !== "");

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
