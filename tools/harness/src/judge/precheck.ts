import type { CommandContext } from "../runtime/index.js";
import {
  gatherChecks,
  parsePrView,
  type Checks,
  type PrView,
} from "./checks.js";
import { parseDeclaration, type Pattern } from "./declaration.js";
import { parseDiff } from "./diff.js";
import { JudgeError } from "./errors.js";
import { hintsFor, type Hints } from "./hints.js";
import { withManifestSides } from "./manifest-source.js";
import { assess } from "./verdict.js";

export interface Report {
  pr: number;
  ok: boolean;
  /** The head commit the verdict covers; the merge tool merges only this one. */
  head?: string;
  pattern: Pattern | undefined;
  idea: string | undefined;
  declaration: { ok: boolean; reason?: string };
  checks?: Checks;
  hints?: Hints;
  patternMatches?: boolean;
  patternMismatch?: string;
  clusterFacing?: boolean;
  unverified?: string[];
}

const FIX =
  "Check `gh auth status` and the PR number, then rerun `harness judge precheck <pr>`.";

async function run(
  { deps }: CommandContext,
  root: string,
  args: readonly string[],
  pr: number,
): Promise<string> {
  const done = await deps.runner.run("gh", args, { cwd: root });
  if (done.code !== 0) {
    throw new JudgeError(
      `gh ${args.slice(0, 2).join(" ")} failed for PR #${pr}: ${done.stderr.trim()}. ${FIX}`,
    );
  }
  return done.stdout;
}

async function gh(
  context: CommandContext,
  root: string,
  repo: string,
  args: string[],
  pr: number,
): Promise<string> {
  // The repository is named, never taken from the working directory or GH_REPO.
  return run(context, root, [...args, "--repo", repo], pr);
}

export async function readPr(
  context: CommandContext,
  root: string,
  repo: string,
  pr: number,
): Promise<PrView> {
  const out = await gh(
    context,
    root,
    repo,
    [
      "pr",
      "view",
      String(pr),
      "--json",
      "baseRefOid,body,comments,commits,headRefOid,statusCheckRollup",
    ],
    pr,
  );
  const view = parsePrView(out);
  if (view === undefined) {
    throw new JudgeError(`gh returned unreadable output for PR #${pr}. ${FIX}`);
  }
  return view;
}

/**
 * Reports whether a PR is ready for the judge. The declaration is checked first;
 * an invalid one fails before the diff or any check result is read.
 */
export async function precheck(
  context: CommandContext,
  root: string,
  repo: string,
  pr: number,
  reviewers: readonly string[],
): Promise<Report> {
  const view = await readPr(context, root, repo, pr);
  const declaration = parseDeclaration(view.body);
  if (!declaration.ok) {
    return {
      pr,
      ok: false,
      pattern: undefined,
      idea: undefined,
      declaration: { ok: false, reason: declaration.reason },
    };
  }
  const diff = await gh(context, root, repo, ["pr", "diff", String(pr)], pr);
  const checks = await gatherChecks(
    context.deps.runner,
    root,
    repo,
    view,
    reviewers,
  );
  const files = await withManifestSides(
    parseDiff(diff),
    (args) => run(context, root, args, pr),
    repo,
    view.baseSha,
    view.headSha,
  );
  const hints = hintsFor(declaration.pattern, files);
  const verdict = assess(declaration.pattern, hints, files);
  return {
    pr,
    head: view.headSha,
    ok:
      verdict.patternMatches &&
      Object.values(checks).every((c) => c.result === "pass"),
    pattern: declaration.pattern,
    idea: declaration.idea,
    declaration: { ok: true },
    checks,
    hints,
    ...verdict,
  };
}

export function summary(report: Report): string {
  const head = `PR #${report.pr}: ${report.ok ? "ready for the judge" : "not ready"}`;
  if (report.checks === undefined) {
    return `${head}\n${report.declaration.reason ?? ""}\n`;
  }
  const checks = Object.entries(report.checks).map(
    ([name, c]) =>
      `${name}: ${c.result}${c.detail === undefined ? "" : ` (${c.detail})`}`,
  );
  const hints = Object.entries(report.hints ?? {}).map(
    ([k, v]) => `${k}: ${JSON.stringify(v)}`,
  );
  const mismatch =
    report.patternMismatch === undefined
      ? []
      : [`pattern mismatch: ${report.patternMismatch}`];
  const unverified = (report.unverified ?? []).map((u) => `unverified: ${u}`);
  return [
    head,
    `pattern: ${report.pattern ?? "none"}${report.idea === undefined ? "" : ` (idea ${report.idea})`}`,
    ...checks,
    ...hints.map((h) => `hint ${h}`),
    ...mismatch,
    `cluster-facing: ${report.clusterFacing === true}`,
    ...unverified,
    "",
  ].join("\n");
}
