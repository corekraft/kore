// Reads the one issue pinned on the repository, where the owner digest is posted (ADR 0120). The
// digest is never posted to an issue the owner did not pin: none, or more than one, is refused.
import type { DigestTarget } from "./digest.js";
import { DecisionError } from "./decision.js";

/** Runs `gh` with the given arguments; the caller's runner supplies the process. */
export type GhRun = (
  args: readonly string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

const QUERY =
  "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { pinnedIssues(first: 5) { nodes { issue { url } } } } }";

const ISSUE_URL = /github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)$/;

interface PinnedReply {
  data: {
    repository: { pinnedIssues: { nodes: { issue: { url: string } }[] } };
  };
}

/** The one pinned issue of the current repository, as the digest's target. */
export async function pinnedDigestIssue(run: GhRun): Promise<DigestTarget> {
  const done = await run([
    "api",
    "graphql",
    "-F",
    "owner={owner}",
    "-F",
    "name={repo}",
    "-f",
    `query=${QUERY}`,
  ]);
  if (done.code !== 0) {
    throw new DecisionError(
      `Reading the pinned issues failed: ${done.stderr.trim()}. Check \`gh auth status\`, then rerun the same command.`,
    );
  }
  const nodes = (JSON.parse(done.stdout) as PinnedReply).data.repository
    .pinnedIssues.nodes;
  if (nodes.length === 0) {
    throw new DecisionError(
      "No issue is pinned for the owner digest. Pin the one issue the digest should post to, then rerun.",
    );
  }
  if (nodes.length > 1) {
    throw new DecisionError(
      `${nodes.length} issues are pinned for the owner digest. Unpin all but one, then rerun.`,
    );
  }
  const url = (nodes[0] as { issue: { url: string } }).issue.url;
  const found = ISSUE_URL.exec(url);
  if (found === null) {
    throw new DecisionError(
      `The pinned issue ${url} is not an issue URL the digest can post to. Pin an issue of this repository, then rerun.`,
    );
  }
  return { number: found[2] as string, repo: found[1] as string };
}
