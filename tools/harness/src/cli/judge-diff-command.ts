import { diffStat, JudgeError, selectDiff } from "../judge/index.js";
import type { Command, CommandContext, CommandHelp } from "../runtime/index.js";
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

const diffHelp: CommandHelp = {
  purpose:
    "Prints a PR's diff through gh, limited to the files its --path globs match; with --stat it prints each file's added and removed line counts instead.",
  when: "When the judge reads the change itself, for example to check it against its declared pattern before approving or merging it.",
  whenNot:
    "When the verdict is what you need, use judge precheck. This reads the diff only and says nothing about checks; for a PR's checks use pr checks.",
  flags: {
    path: "Comma-separated globs of the files to keep: * stays in one folder and ** crosses folders. Without it every changed file is kept; a glob that matches no file fails the command.",
    stat: "Print each changed file's added and removed line counts and the number of files changed, instead of the diff.",
  },
  operand: "The pull request number, a positive whole number.",
  examples: [
    {
      command: 'harness judge diff 942 --path "skills/**"',
      shows: "PR 942's diff, only for the files under skills/",
    },
    {
      command: "harness judge diff 942 --stat",
      shows:
        "each changed file's added and removed lines, then the number of files changed",
    },
  ],
  exits: [
    { code: 0, meaning: "the diff, or its stat, is printed" },
    {
      code: 1,
      meaning:
        "gh could not read the PR, or no file matches --path; stderr names the fix",
    },
    {
      code: 2,
      meaning:
        "a usage error: a flag the command does not declare, a second operand, or a flag with no value",
    },
  ],
  effects: {
    kind: "read-only",
    detail: "reads the PR's diff through gh and prints it; changes nothing",
  },
  seeAlso: ["judge precheck", "pr checks"],
};

export const diffCommands: Record<string, Command> = {
  diff: {
    summary:
      "print a PR's diff, or with --stat its per-file line counts, limited to --path globs",
    operand: "pr",
    options: { path: "string", stat: "boolean" },
    help: diffHelp,
    run: runDiff,
  },
};
