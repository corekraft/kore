import type { FrontierIssue } from "./exclusion.js";

/** A search answer the frontier cannot use; the message says what to fix. */
export class FrontierError extends Error {}

/** Runs `gh` with these arguments and returns its stdout; the caller decides what a failure means. */
export type GhRun = (args: string[]) => Promise<string>;

const PAGE_SIZE = 100;

/** The owner's search, the same string the owner has always used, with its paging variable. */
const query = (repo: string) =>
  `query($cursor: String) { search(query: "repo:${repo} is:issue is:open label:ready-for-agent", type: ISSUE, first: ${PAGE_SIZE}, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { ... on Issue { number title body createdAt labels(first: ${PAGE_SIZE}) { nodes { name } } assignees { totalCount } issueDependenciesSummary { blockedBy } subIssuesSummary { total } } } } }`;

interface Page {
  nodes: unknown[];
  hasNextPage: boolean;
  endCursor: string | undefined;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

const count = (value: unknown, key: string): number => {
  const found = record(value)?.[key];
  return typeof found === "number" ? found : 0;
};

const unreadable = () =>
  new FrontierError(
    "gh returned an unreadable issue search; rerun the command.",
  );

/** One page of the search: its nodes and where the next page starts. */
function parsePage(text: string): Page {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw unreadable();
  }
  const root = record(value);
  if (root?.["errors"] !== undefined) {
    const messages = (root["errors"] as unknown[])
      .map((e) => record(e)?.["message"])
      .filter((m): m is string => typeof m === "string");
    throw new FrontierError(
      `The issue search returned an error: ${messages.join("; ")}. Check the query and \`gh auth status\`, then rerun.`,
    );
  }
  const search = record(record(root?.["data"])?.["search"]);
  const pageInfo = record(search?.["pageInfo"]);
  const nodes = search?.["nodes"];
  if (pageInfo === undefined || !Array.isArray(nodes)) {
    throw unreadable();
  }
  const endCursor =
    typeof pageInfo["endCursor"] === "string"
      ? pageInfo["endCursor"]
      : undefined;
  return {
    nodes,
    hasNextPage: pageInfo["hasNextPage"] === true,
    endCursor,
  };
}

const textOf = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** One search node as the frontier's facts; a node that is not an issue is skipped. */
function issueOf(node: unknown): FrontierIssue | undefined {
  const fields = record(node);
  if (fields === undefined || typeof fields["number"] !== "number") {
    return undefined;
  }
  const labels =
    (record(fields["labels"])?.["nodes"] as unknown[] | undefined) ?? [];
  return {
    number: fields["number"],
    title: textOf(fields["title"]),
    body: textOf(fields["body"]),
    createdAt: textOf(fields["createdAt"]),
    labels: labels
      .map((label) => textOf(record(label)?.["name"]))
      .filter((name) => name !== ""),
    assignees: count(fields["assignees"], "totalCount"),
    openBlockers: count(fields["issueDependenciesSummary"], "blockedBy"),
    subIssues: count(fields["subIssuesSummary"], "total"),
  };
}

/**
 * Every open issue labelled ready-for-agent, read through one paginated GraphQL
 * search. Nothing is excluded here: the frontier rule decides that, with a reason.
 */
export async function readReadyIssues(
  run: GhRun,
  repo: string,
): Promise<FrontierIssue[]> {
  const issues: FrontierIssue[] = [];
  let cursor: string | undefined;
  for (;;) {
    const args = ["api", "graphql", "-f", `query=${query(repo)}`];
    if (cursor !== undefined) {
      args.push("-f", `cursor=${cursor}`);
    }
    const page = parsePage(await run(args));
    for (const node of page.nodes) {
      const issue = issueOf(node);
      if (issue !== undefined) {
        issues.push(issue);
      }
    }
    if (!page.hasNextPage) {
      return issues;
    }
    if (page.endCursor === undefined) {
      throw new FrontierError(
        "The issue search said more pages follow but gave no cursor; rerun the command.",
      );
    }
    cursor = page.endCursor;
  }
}
