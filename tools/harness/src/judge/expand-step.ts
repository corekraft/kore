import type { Api } from "./manifest-source.js";

/** A reviewer's line on the idea issue that proves the expand step named by its number. */
const PROOF = /^\s*Expand proof:\s*#(\d+)\b/i;
/** The Idea line's issue, with or without its `#`. */
const ISSUE = /^#?(\d+)$/;

/** A comment on an issue: its author's login, body and creation time. */
export interface ExpandComment {
  body: string;
  author: string;
  createdAt: string;
}

/** The result of the expand step check: a subset of the precheck's check results. */
export interface ExpandCheck {
  result: "pass" | "pending" | "fail" | "missing";
  detail?: string;
}

export interface ExpandFacts {
  /** The contract PR the precheck judges. */
  pr: number;
  /** The merged expand PR the contract names. */
  expandPr: number;
  /** When the expand PR merged; undefined while it is not merged. */
  mergedAt: string | undefined;
  /** When the contract's newest commit was made; undefined when it lists none. */
  headCommittedAt: string | undefined;
  /** The Idea line of the contract; the issue that records the proof, when it names one. */
  idea: string | undefined;
  /** The comments on that issue. */
  comments: ExpandComment[];
  /** The logins whose proof counts. */
  reviewers: readonly string[];
}

/**
 * Whether a contract's expand step is proven: the expand PR merged, it merged before the
 * contract's head commit, and a recognised reviewer recorded its proof on the idea issue.
 * Each refusal names what is missing and how to fix it.
 */
export function expandStepCheck(facts: ExpandFacts): ExpandCheck {
  const step = `expand step #${facts.expandPr}`;
  const rerun = `rerun \`harness judge precheck ${facts.pr}\``;
  if (facts.mergedAt === undefined) {
    return {
      result: "pending",
      detail: `${step} is not merged; merge it, then ${rerun}`,
    };
  }
  if (facts.headCommittedAt === undefined) {
    return {
      result: "missing",
      detail: `this PR has no commit to order the expand step against; ${rerun}`,
    };
  }
  if (Date.parse(facts.mergedAt) >= Date.parse(facts.headCommittedAt)) {
    return {
      result: "fail",
      detail: `${step} merged at ${facts.mergedAt}, not before this PR's head commit at ${facts.headCommittedAt}; push a commit to this PR after the expand step merged, then ${rerun}`,
    };
  }
  const issueFix =
    "name the issue that records the expand proof (Idea: <issue number>)";
  const issue = ISSUE.exec(facts.idea ?? "")?.[1];
  if (issue === undefined) {
    return {
      result: "missing",
      detail:
        facts.idea === undefined
          ? `the PR has no Idea line; ${issueFix}`
          : `the Idea line names "${facts.idea}", not an issue number; ${issueFix}`,
    };
  }
  const proven = facts.comments.some(
    (c) =>
      facts.reviewers.includes(c.author) &&
      c.body
        .split("\n")
        .some((line) => PROOF.exec(line)?.[1] === String(facts.expandPr)),
  );
  return proven
    ? { result: "pass" }
    : {
        result: "missing",
        detail: `no "Expand proof: #${facts.expandPr}" comment from ${facts.reviewers.join(" or ")} on issue #${issue}; the owner records it there once the expand outcome is recorded, then ${rerun}`,
      };
}

/** The merge time of a PR from `gh pr view --json mergedAt`; undefined when the output is not JSON. */
export function parseExpandPr(
  stdout: string,
): { mergedAt: string | undefined } | undefined {
  try {
    const view = JSON.parse(stdout) as { mergedAt?: unknown };
    return {
      mergedAt: typeof view.mergedAt === "string" ? view.mergedAt : undefined,
    };
  } catch {
    return undefined;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function commentOf(c: Record<string, unknown>): ExpandComment {
  const author = (c["author"] as Record<string, unknown> | null)?.["login"];
  return {
    body: text(c["body"]),
    author: text(author),
    createdAt: text(c["createdAt"]),
  };
}

/** The comments of an issue from `gh issue view --json comments`; undefined when the output is not JSON. */
export function parseIssueComments(
  stdout: string,
): ExpandComment[] | undefined {
  try {
    const view = JSON.parse(stdout) as { comments?: unknown };
    return Array.isArray(view.comments)
      ? (view.comments as Record<string, unknown>[]).map(commentOf)
      : [];
  } catch {
    return undefined;
  }
}

/**
 * Reads the expand PR's merge time, and the idea issue's comments when the idea names one,
 * through gh; unreadable output is a missing check, not a verdict.
 */
export async function readExpandStep(
  api: Api,
  facts: Omit<ExpandFacts, "mergedAt" | "comments">,
): Promise<ExpandCheck> {
  const { pr, expandPr, idea, headCommittedAt, reviewers } = facts;
  const merged = parseExpandPr(
    await api(["pr", "view", String(expandPr), "--json", "mergedAt"]),
  );
  if (merged === undefined) {
    return {
      result: "missing",
      detail: `gh returned unreadable output for expand step #${expandPr}`,
    };
  }
  const issue = ISSUE.exec(idea ?? "")?.[1];
  let comments: ExpandComment[] = [];
  if (issue !== undefined) {
    const parsed = parseIssueComments(
      await api(["issue", "view", issue, "--json", "comments"]),
    );
    if (parsed === undefined) {
      return {
        result: "missing",
        detail: `gh returned unreadable comments for issue #${issue}`,
      };
    }
    comments = parsed;
  }
  return expandStepCheck({
    pr,
    expandPr,
    mergedAt: merged.mergedAt,
    headCommittedAt,
    idea,
    comments,
    reviewers,
  });
}
