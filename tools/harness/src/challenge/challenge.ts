import { IdeaError, issueTarget } from "../idea/index.js";
import type { IdeaRepository } from "../idea/index.js";
import type { Runner } from "../runtime/index.js";
import { MAX_ROUNDS, parseRounds, renderRound } from "./model.js";

export interface Context {
  repo: IdeaRepository;
  runner: Runner;
  root: string;
}

export interface Challenged {
  idea: string;
  round: number;
  objections: string[];
  issue: string;
}

/** The third round was asked for: the idea goes to a person, with what is still open. */
export class RoundLimit extends IdeaError {
  constructor(
    readonly rounds: number,
    readonly openObjections: string[],
    message: string,
  ) {
    super(message);
  }
}

const FIX = "Check `gh auth status`, then rerun `harness idea challenge`.";

function commentBodies(stdout: string, issue: string): string[] {
  try {
    const view = JSON.parse(stdout) as { comments?: unknown };
    return Array.isArray(view.comments)
      ? view.comments.flatMap((c: unknown) => {
          const body = (c as { body?: unknown } | null)?.body;
          return typeof body === "string" ? [body] : [];
        })
      : [];
  } catch {
    throw new IdeaError(
      `gh returned unreadable output for issue ${issue}; ${FIX}`,
    );
  }
}

/**
 * Posts one challenge round on the idea's issue. Rounds are counted from the
 * issue's own comments, so the limit holds from any checkout. Past the limit
 * nothing is written: the refusal hands the idea to a person with the open
 * objections of the last round.
 */
export async function challengeIdea(
  ctx: Context,
  ref: string,
  objections: readonly string[],
): Promise<Challenged> {
  const record = await ctx.repo.get(ref);
  const target = await issueTarget(ctx.runner, ctx.root, record);
  const issue = `https://github.com/${target.repo}/issues/${target.number}`;
  const gh = (args: string[], input?: string) =>
    ctx.runner.run("gh", args, {
      cwd: ctx.root,
      ...(input === undefined ? {} : { input }),
    });
  const view = await gh([
    "issue",
    "view",
    target.number,
    "--repo",
    target.repo,
    "--json",
    "comments",
  ]);
  if (view.code !== 0) {
    throw new IdeaError(
      `gh could not read issue ${issue}: ${view.stderr.trim()}. ${FIX}`,
    );
  }
  const rounds = parseRounds(record.number, commentBodies(view.stdout, issue));
  if (rounds.length >= MAX_ROUNDS) {
    const open = rounds.at(-1)?.objections ?? [];
    throw new RoundLimit(
      rounds.length,
      open,
      [
        `Idea ${record.number} has used the limit of ${MAX_ROUNDS} challenge rounds, so it goes to a person to approve or reject (${issue}).`,
        open.length === 0
          ? "No open objections."
          : `Open objections:\n${open.map((o) => `- ${o}`).join("\n")}`,
      ].join("\n"),
    );
  }
  const round = rounds.length + 1;
  const post = await gh(
    [
      "issue",
      "comment",
      target.number,
      "--repo",
      target.repo,
      "--body-file",
      "-",
    ],
    renderRound(record.number, round, objections),
  );
  if (post.code !== 0) {
    throw new IdeaError(
      `gh could not post round ${round} on ${issue}: ${post.stderr.trim()}. ${FIX}`,
    );
  }
  return {
    idea: record.number,
    round,
    objections: [...objections],
    issue,
  };
}
