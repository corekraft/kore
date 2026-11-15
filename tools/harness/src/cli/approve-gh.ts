import { ApproveError } from "../approve/index.js";
import type { CommandContext, Runner } from "../runtime/index.js";
import { repoOf } from "./judge-shared.js";

const APPROVED = "ready-for-agent";

/** The GitHub calls an approval makes on one issue, all through the injected runner. */
export interface IssueIo {
  labels(issue: number): Promise<string[]>;
  comments(issue: number): Promise<string[]>;
  comment(issue: number, body: string): Promise<void>;
  label(issue: number): Promise<void>;
}

/** The issue calls on `repo`, always with --repo so a stray GH_REPO or working directory never decides. */
export function ghIssueIo(runner: Runner, repo: string, cwd: string): IssueIo {
  const gh = async (verb: string, issue: number, rest: string[]) => {
    const done = await runner.run(
      "gh",
      ["issue", verb, String(issue), "--repo", repo, ...rest],
      { cwd },
    );
    if (done.code !== 0) {
      throw new ApproveError(
        `gh issue ${verb} failed for issue #${issue}: ${done.stderr.trim()}. Check \`gh auth status\` and the issue number, then rerun \`harness approve\`.`,
      );
    }
    return done.stdout;
  };
  const names = async (issue: number, field: "labels" | "comments") => {
    const text = await gh("view", issue, ["--json", field]);
    try {
      const rows = (JSON.parse(text) as Record<string, unknown>)[field];
      const key = field === "labels" ? "name" : "body";
      if (Array.isArray(rows)) {
        return rows.map((row) => String((row as Record<string, unknown>)[key]));
      }
    } catch {
      // Reported below with the rest of the unreadable output.
    }
    throw new ApproveError(
      `gh returned unreadable ${field} for issue #${issue}; rerun \`harness approve\`.`,
    );
  };
  return {
    labels: (issue) => names(issue, "labels"),
    comments: (issue) => names(issue, "comments"),
    comment: async (issue, body) => {
      await gh("comment", issue, ["--body", body]);
    },
    label: async (issue) => {
      await gh("edit", issue, ["--add-label", APPROVED]);
    },
  };
}

/** The issue calls on the repository this bundle was built in, run from the repository root. */
export async function openIssueIo(context: CommandContext): Promise<IssueIo> {
  return ghIssueIo(
    context.deps.runner,
    await repoOf(context),
    await context.deps.root(),
  );
}
