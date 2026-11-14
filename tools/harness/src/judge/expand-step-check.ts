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
