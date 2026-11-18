import type { CommandContext } from "../runtime/index.js";
import {
  castAudit,
  gatherChecks,
  gatherExpandStep,
  gatherGuardrailChanges,
  lengthAudit,
  parsePrView,
  type AuditFinding,
  type Checks,
  type ItemVerdict,
  type PrView,
} from "./checks.js";
import { parseDeclaration, type Pattern } from "./declaration.js";
import { parseDiff, type ChangedFile } from "./diff.js";
import { JudgeError } from "./errors.js";
import { hintsFor, type Hints } from "./hints.js";
import { withManifestSides, type Api } from "./manifest-source.js";
import { assess } from "./verdict.js";

export interface Report {
  pr: number;
  ok: boolean;
  /** The head commit the verdict covers; the merge tool merges only this one. */
  head?: string;
  /** The logins whose principles-review verdicts this report trusted. */
  reviewers: string[];
  pattern: Pattern | undefined;
  idea: string | undefined;
  declaration: { ok: boolean; reason?: string };
  checks?: Checks;
  /** Each checklist item with the mode it read; present once the modes were applied. */
  checklist?: ItemVerdict[];
  /** The audit items that did not pass: shown here, never a reason to send the change back. */
  audited?: ItemVerdict[];
  hints?: Hints;
  patternMatches?: boolean;
  patternMismatch?: string;
  clusterFacing?: boolean;
  unverified?: string[];
  /** Present only when the diff touches the guardrail inventory: each `rule:from>to` change that needs an activation. */
  guardrailChanges?: string[];
  /** Present only when a changed file is over a limit: the audit items, shown here and never a reason the check fails. */
  audits?: AuditFinding[];
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
  args: readonly string[],
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
 * The changes the diff makes, as report fields: the guardrail inventory changes (nothing when it is
 * left alone) and the audit items of the changed files (nothing when no file is over a limit).
 */
async function diffChanges(
  api: Api,
  repo: string,
  files: ChangedFile[],
  view: PrView,
): Promise<{ guardrailChanges?: string[]; audits?: AuditFinding[] }> {
  const guardrailChanges = await gatherGuardrailChanges(
    files,
    api,
    repo,
    view.baseSha,
    view.headSha,
  );
  const audits = [
    ...(await lengthAudit(api, repo, view.headSha, files)),
    ...castAudit(files),
  ];
  return {
    ...(guardrailChanges === undefined ? {} : { guardrailChanges }),
    ...(audits.length === 0 ? {} : { audits }),
  };
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
      reviewers: [...reviewers],
      pattern: undefined,
      idea: undefined,
      declaration: { ok: false, reason: declaration.reason },
    };
  }
  const diff = await gh(context, root, repo, ["pr", "diff", String(pr)], pr);
  const gathered = await gatherChecks(
    context.deps.runner,
    root,
    repo,
    view,
    reviewers,
  );
  const api: Api = (args) => run(context, root, args, pr);
  const files = await withManifestSides(
    parseDiff(diff),
    api,
    repo,
    view.baseSha,
    view.headSha,
  );
  const hints = hintsFor(declaration.pattern, files);
  const unproven = assess(declaration.pattern, hints, files);
  // Only a contract that names its expand step, and whose diff fails its pattern, reads it.
  const expandStep = declaration.expandStep;
  const expand =
    unproven.patternMatches || expandStep === undefined
      ? undefined
      : await gatherExpandStep({
          api: (ghArgs) => gh(context, root, repo, ghArgs, pr),
          pr,
          view,
          reviewers,
          declared: { idea: declaration.idea, expandStep },
        });
  const verdict =
    expand === undefined
      ? unproven
      : assess(declaration.pattern, hints, files, expand.result === "pass");
  const checks: Checks =
    expand === undefined ? gathered : { ...gathered, expandStep: expand };
  return {
    pr,
    head: view.headSha,
    reviewers: [...reviewers],
    ok:
      verdict.patternMatches &&
      Object.values(checks).every((c) => c.result === "pass"),
    pattern: declaration.pattern,
    idea: declaration.idea,
    declaration: { ok: true },
    checks,
    hints,
    ...verdict,
    ...(await diffChanges(api, repo, files, view)),
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
  const audited = (report.audited ?? []).map(
    (a) =>
      `audit: ${a.item} ${a.result}${a.detail === undefined || a.detail === "" ? "" : ` (${a.detail})`}; reported, not sent back`,
  );
  const found = (report.audits ?? []).map(
    (a) =>
      `audit: ${a.item} ${a.file}${a.line === undefined ? "" : `:${a.line}`}: ${a.detail}; fix: ${a.fix}; reported, not sent back`,
  );
  const unverified = (report.unverified ?? []).map((u) => `unverified: ${u}`);
  return [
    head,
    `pattern: ${report.pattern ?? "none"}${report.idea === undefined ? "" : ` (idea ${report.idea})`}`,
    `reviewers: ${report.reviewers.join(", ")}`,
    ...checks,
    ...audited,
    ...found,
    ...hints.map((h) => `hint ${h}`),
    ...mismatch,
    `cluster-facing: ${report.clusterFacing === true}`,
    ...unverified,
    "",
  ].join("\n");
}
