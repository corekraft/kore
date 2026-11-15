import { join } from "node:path";
import { INVENTORY_PATH } from "../guardrail/index.js";
import { IdeaError } from "../idea/index.js";
import type { Runner } from "../runtime/index.js";
import type { RevertChange, RevertPr } from "./revert.js";

/** The safety pattern every prepared revert declares. */
export const REVERT_BODY_SAFETY = "no-behaviour-change";

const branchFor = (issue: number) => `revert/idea-${issue}`;

function parse(stdout: string, what: string): Record<string, unknown> {
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new IdeaError(
      `${what} returned unreadable output. Check \`gh auth status\`, then rerun \`harness evaluate\`.`,
    );
  }
}

/** The git and gh steps that prepare a revert PR from a throwaway worktree, never the caller's checkout. */
export class GitRevert {
  constructor(
    private readonly runner: Runner,
    private readonly root: string,
    private readonly scratch: string,
  ) {}

  private async gh(args: string[]): Promise<string> {
    const done = await this.runner.run("gh", args, { cwd: this.root });
    if (done.code !== 0) {
      throw new IdeaError(
        `\`gh ${args.slice(0, 3).join(" ")}\` failed: ${done.stderr.trim()}. Check \`gh auth status\`, then rerun \`harness evaluate\`.`,
      );
    }
    return done.stdout;
  }

  private async git(args: string[], cwd: string): Promise<string> {
    const done = await this.runner.run("git", args, { cwd });
    if (done.code !== 0) {
      throw new IdeaError(
        `\`git ${args[0]}\` failed: ${done.stderr.trim()}. Fix it, then rerun \`harness evaluate\`.`,
      );
    }
    return done.stdout;
  }

  async existing(issue: number): Promise<RevertPr | undefined> {
    const out = await this.gh([
      "pr",
      "list",
      "--head",
      branchFor(issue),
      "--state",
      "all",
      "--json",
      "number,url",
    ]);
    try {
      const [first] = JSON.parse(out) as RevertPr[];
      return first;
    } catch {
      throw new IdeaError(
        "`gh pr list` returned unreadable output. Check `gh auth status`, then rerun `harness evaluate`.",
      );
    }
  }

  async touchesGuardrail(pr: number): Promise<boolean> {
    const view = parse(
      await this.gh(["pr", "view", String(pr), "--json", "files"]),
      "`gh pr view`",
    );
    const files = Array.isArray(view["files"]) ? view["files"] : [];
    return files.some((f) => (f as { path?: unknown }).path === INVENTORY_PATH);
  }

  async prepare({ idea, issue, pr }: RevertChange): Promise<RevertPr> {
    const view = parse(
      await this.gh(["pr", "view", String(pr), "--json", "mergeCommit"]),
      "`gh pr view`",
    );
    const sha = (view["mergeCommit"] as { oid?: unknown } | null)?.oid;
    if (typeof sha !== "string") {
      throw new IdeaError(
        `PR #${pr} has no merge commit, so it is not merged; wait for the merge, then rerun \`harness evaluate\`.`,
      );
    }
    const branch = branchFor(issue);
    const dir = join(this.scratch, `revert-idea-${issue}`);
    await this.git(["fetch", "origin", "main"], this.root);
    await this.git(
      ["worktree", "add", "-b", branch, dir, "origin/main"],
      this.root,
    );
    let opened = false;
    try {
      const made = await this.open({ idea, issue, pr }, sha, branch, dir);
      opened = true;
      return made;
    } finally {
      await this.runner.run("git", ["worktree", "remove", "--force", dir], {
        cwd: this.root,
      });
      if (!opened) {
        // A branch left behind would stop a rerun at `worktree add -b`.
        await this.runner.run("git", ["branch", "-D", branch], {
          cwd: this.root,
        });
      }
    }
  }

  private async open(
    { idea, issue, pr }: RevertChange,
    sha: string,
    branch: string,
    dir: string,
  ): Promise<RevertPr> {
    const reverted = await this.runner.run(
      "git",
      ["revert", "--no-commit", sha],
      { cwd: dir },
    );
    if (reverted.code !== 0) {
      throw new IdeaError(
        `Reverting #${pr} failed: ${reverted.stderr.trim()}. Revert it by hand, then rerun \`harness evaluate\`.`,
      );
    }
    const summary = `Reverts #${pr}, the change for harness idea ${idea}, whose recorded outcome is refuted.`;
    await this.git(
      [
        "commit",
        "-m",
        `revert(harness): undo refuted idea ${idea} (#${pr})`,
        "-m",
        summary,
      ],
      dir,
    );
    await this.git(["push", "origin", branch], dir);
    const body = [
      summary,
      "Prepared by `harness evaluate`. It is not merged here: the judge approves and merges it like any change.",
      `Refs #${issue}`,
      `Idea: ${issue}`,
      `Safety pattern: ${REVERT_BODY_SAFETY}`,
    ].join("\n\n");
    const created = await this.runner.run(
      "gh",
      [
        "pr",
        "create",
        "--base",
        "main",
        "--head",
        branch,
        "--title",
        `revert(harness): undo refuted idea ${idea} (#${pr})`,
        "--body",
        body,
      ],
      { cwd: dir },
    );
    const url = created.stdout.trim();
    const number = Number(/\/pull\/(\d+)$/.exec(url)?.[1]);
    if (created.code !== 0 || !Number.isSafeInteger(number)) {
      throw new IdeaError(
        `\`gh pr create\` failed: ${created.stderr.trim() || url}. The branch ${branch} is pushed; open its PR by hand with \`Safety pattern: ${REVERT_BODY_SAFETY}\`.`,
      );
    }
    return { number, url };
  }
}
