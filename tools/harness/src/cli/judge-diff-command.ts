import { diffStat, JudgeError, selectDiff } from "../judge/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { failed, prNumber, repoOf } from "./judge-shared.js";

const DIFF_USAGE =
  "Run `harness judge diff <pr> [--path <glob>[,<glob>]] [--stat] [--json]`.";

/** The globs `--path` names: comma-separated, trimmed, none when the flag is absent. */
function globsOf(context: CommandContext): string[] {
  const flag = context.options["path"];
  return typeof flag === "string"
    ? flag
        .split(",")
        .map((glob) => glob.trim())
        .filter((glob) => glob !== "")
    : [];
}

/** Reads the PR's diff through gh and prints it (or its per-file stat), limited to the files the globs match. */
async function runDiff(context: CommandContext): Promise<number> {
  const { deps, json } = context;
  try {
    const pr = prNumber(context.operand, DIFF_USAGE);
    const root = await deps.root();
    const repo = await repoOf(context);
    const done = await deps.runner.run(
      "gh",
      ["pr", "diff", String(pr), "--repo", repo],
      { cwd: root },
    );
    if (done.code !== 0) {
      throw new JudgeError(
        `gh pr diff failed for PR #${pr}: ${done.stderr.trim()}. Check \`gh auth status\` and the PR number, then rerun \`harness judge diff ${pr}\`.`,
      );
    }
    const globs = globsOf(context);
    const files = diffStat(done.stdout, globs);
    if (globs.length > 0 && files.length === 0) {
      throw new JudgeError(
        `No file in PR #${pr} matches ${globs.join(", ")}. Run \`harness judge diff ${pr} --stat\` to list the changed files, then pass a glob that matches one.`,
      );
    }
    if (context.options["stat"] === true) {
      deps.stdout(
        json
          ? `${JSON.stringify({ pr, files })}\n`
          : `${files.map((f) => `${f.path} | +${f.added} -${f.removed}\n`).join("")}${files.length} files changed\n`,
      );
    } else {
      const diff = selectDiff(done.stdout, globs);
      deps.stdout(json ? `${JSON.stringify({ pr, files, diff })}\n` : diff);
    }
    return 0;
  } catch (error) {
    return failed(context, error);
  }
}

export const diffCommands: Record<string, Command> = {
  diff: {
    summary:
      "read-only on GitHub; print a PR's diff through gh, limited to the files matching --path globs (comma-separated; * stays in one folder, ** crosses folders), or with --stat only each file's added and removed line counts; fails when no file matches (<pr> [--path <glob>[,<glob>]] [--stat] [--json])",
    operand: "pr",
    options: { path: "string", stat: "boolean" },
    run: runDiff,
  },
};
