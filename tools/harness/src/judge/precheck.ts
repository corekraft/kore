import type { CommandContext } from "../runtime/index.js";
import {
  gatherChecks,
  parsePrView,
  type Checks,
  type PrView,
} from "./checks.js";
import { parseDeclaration, type Pattern } from "./declaration.js";
import { parseDiff } from "./diff.js";
import { hintsFor, type Hints } from "./hints.js";

export class JudgeError extends Error {}

export interface Report {
  pr: number;
  ok: boolean;
  pattern: Pattern | undefined;
  idea: string | undefined;
  declaration: { ok: boolean; reason?: string };
  checks?: Checks;
  hints?: Hints;
}

const FIX =
  "Check `gh auth status` and the PR number, then rerun `harness judge precheck <pr>`.";

async function gh(
  { deps }: CommandContext,
  root: string,
  args: string[],
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

async function readPr(
  context: CommandContext,
  root: string,
  pr: number,
): Promise<PrView> {
  const out = await gh(
    context,
    root,
    ["pr", "view", String(pr), "--json", "body,comments,statusCheckRollup"],
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
  pr: number,
): Promise<Report> {
  const view = await readPr(context, root, pr);
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
  const diff = await gh(context, root, ["pr", "diff", String(pr)], pr);
  const checks = await gatherChecks(context.deps.runner, root, view);
  return {
    pr,
    ok: Object.values(checks).every((c) => c.result === "pass"),
    pattern: declaration.pattern,
    idea: declaration.idea,
    declaration: { ok: true },
    checks,
    hints: hintsFor(declaration.pattern, parseDiff(diff)),
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
  return [
    head,
    `pattern: ${report.pattern ?? "none"}${report.idea === undefined ? "" : ` (idea ${report.idea})`}`,
    ...checks,
    ...hints.map((h) => `hint ${h}`),
    "",
  ].join("\n");
}
