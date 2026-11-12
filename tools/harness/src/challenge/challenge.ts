import { IdeaError, issueTarget } from "../idea/index.js";
import type { IdeaRepository } from "../idea/index.js";
import type { Runner } from "../runtime/index.js";
import {
  distinctRounds,
  duplicateRounds,
  type DuplicateRound,
  MAX_ROUNDS,
  parseRounds,
  renderRound,
  type IssueComment,
  type Round,
} from "./model.js";

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

function issueComments(stdout: string, issue: string): IssueComment[] {
  try {
    const view = JSON.parse(stdout) as { comments?: unknown };
    return Array.isArray(view.comments)
      ? view.comments.flatMap((c: unknown) => {
          const comment = c as {
            body?: unknown;
            url?: unknown;
            author?: { login?: unknown } | null;
          } | null;
          const login = comment?.author?.login;
          return typeof comment?.body === "string"
            ? [
                {
                  body: comment.body,
                  author: typeof login === "string" ? login : "",
                  url: typeof comment.url === "string" ? comment.url : issue,
                },
              ]
            : [];
        })
      : [];
  } catch {
    throw new IdeaError(
      `gh returned unreadable output for issue ${issue}; ${FIX}`,
    );
  }
}

async function ghUser(
  gh: (
    args: string[],
  ) => Promise<{ stdout: string; stderr: string; code: number }>,
): Promise<string> {
  const whoami = await gh(["api", "user", "--jq", ".login"]);
  const user = whoami.stdout.trim();
  if (whoami.code !== 0 || user === "") {
    throw new IdeaError(
      `gh could not name the authenticated user${whoami.stderr.trim() === "" ? "" : `: ${whoami.stderr.trim()}`}. ${FIX}`,
    );
  }
  return user;
}

function roundLimit(idea: string, rounds: readonly Round[], issue: string) {
  const open = rounds.at(-1)?.objections ?? [];
  return new RoundLimit(
    rounds.length,
    open,
    [
      `Idea ${idea} has used the limit of ${MAX_ROUNDS} challenge rounds, so it goes to a person to approve or reject (${issue}).`,
      open.length === 0
        ? "No open objections."
        : `Open objections:\n${open.map((o) => `- ${o}`).join("\n")}`,
    ].join("\n"),
  );
}

function duplicatePost(duplicate: DuplicateRound, issue: string) {
  return new IdeaError(
    `Challenge round ${duplicate.round} on ${issue} was posted twice and both comments are still on the issue:  ${duplicate.urls.join(" and ")}. Another challenge ran at the same time. Delete the one that should not count, then rerun \`harness idea challenge\` if a round is still needed.`,
  );
}

/**
 * Posts one challenge round on the idea's issue. Rounds are counted from the
 * issue's own comments, so the limit holds from any checkout. Past the limit
 * nothing is written: the refusal hands the idea to a person with the open
 * objections of the last round. Only comments by the authenticated gh user
 * count, and after posting the issue is read again: a round number claimed
 * twice (two challenges racing) is reported, naming both comments.
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
  const comments = async (): Promise<IssueComment[]> => {
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
    return issueComments(view.stdout, issue);
  };
  const user = await ghUser(gh);
  const rounds = distinctRounds(
    parseRounds(record.number, await comments(), user),
  );
  if (rounds.length >= MAX_ROUNDS) {
    throw roundLimit(record.number, rounds, issue);
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
  const duplicate = duplicateRounds(
    parseRounds(record.number, await comments(), user),
  ).find((d) => d.round === round);
  if (duplicate !== undefined) {
    throw duplicatePost(duplicate, issue);
  }
  return {
    idea: record.number,
    round,
    objections: [...objections],
    issue,
  };
}
