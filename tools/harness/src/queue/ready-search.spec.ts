import { describe, expect, it, vi } from "vitest";
import { readReadyIssues } from "./ready-search.js";

const QUERY =
  'query($cursor: String) { search(query: "repo:corekraft/kore is:issue is:open label:ready-for-agent", type: ISSUE, first: 100, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { ... on Issue { number title body createdAt labels(first: 100) { nodes { name } } assignees { totalCount } issueDependenciesSummary { blockedBy } subIssuesSummary { total } } } } }';

const node = (number: number, overrides: Record<string, unknown> = {}) => ({
  number,
  title: `Ticket ${number}`,
  body: "Build it.",
  createdAt: "2026-01-02T00:00:00Z",
  labels: { nodes: [{ name: "ready-for-agent" }, { name: "harness" }] },
  assignees: { totalCount: 1 },
  issueDependenciesSummary: { blockedBy: 2 },
  subIssuesSummary: { total: 3 },
  ...overrides,
});

const page = (
  nodes: unknown[],
  hasNextPage: boolean,
  endCursor: string | null = null,
) =>
  JSON.stringify({
    data: { search: { pageInfo: { hasNextPage, endCursor }, nodes } },
  });

describe("readReadyIssues query", () => {
  it("runs the owner's search as one GraphQL query, with no cursor on the first page", async () => {
    const run = vi.fn().mockResolvedValue(page([], false));
    await readReadyIssues(run, "corekraft/kore");
    expect(run).toHaveBeenCalledWith([
      "api",
      "graphql",
      "-f",
      `query=${QUERY}`,
    ]);
  });

  it("follows the cursor page by page and keeps every issue, in the order gh returned them", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(page([node(1)], true, "CUR1"))
      .mockResolvedValueOnce(page([node(2)], false));
    const issues = await readReadyIssues(run, "corekraft/kore");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith([
      "api",
      "graphql",
      "-f",
      `query=${QUERY}`,
      "-f",
      "cursor=CUR1",
    ]);
    expect(issues.map((i) => i.number)).toEqual([1, 2]);
  });
});

describe("readReadyIssues mapping", () => {
  it("maps each issue node to the facts the frontier rule reads", async () => {
    const run = vi.fn().mockResolvedValue(page([node(1404)], false));
    expect(await readReadyIssues(run, "corekraft/kore")).toEqual([
      {
        number: 1404,
        title: "Ticket 1404",
        body: "Build it.",
        createdAt: "2026-01-02T00:00:00Z",
        labels: ["ready-for-agent", "harness"],
        assignees: 1,
        openBlockers: 2,
        subIssues: 3,
      },
    ]);
  });

  it("skips a search node that is not an issue", async () => {
    const run = vi.fn().mockResolvedValue(page([{}, node(5)], false));
    const issues = await readReadyIssues(run, "corekraft/kore");
    expect(issues.map((i) => i.number)).toEqual([5]);
  });
});

describe("readReadyIssues failures", () => {
  it("fails naming GraphQL's own error when the search returns one", async () => {
    const run = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify({ errors: [{ message: "bad query" }] }),
      );
    await expect(readReadyIssues(run, "corekraft/kore")).rejects.toThrow(
      "The issue search returned an error: bad query. Check the query and `gh auth status`, then rerun.",
    );
  });

  it("fails rather than loop when a page says more follow but gives no cursor", async () => {
    const run = vi.fn().mockResolvedValue(page([node(1)], true, null));
    await expect(readReadyIssues(run, "corekraft/kore")).rejects.toThrow(
      "The issue search said more pages follow but gave no cursor; rerun the command.",
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("fails when gh returns something that is not the search", async () => {
    const run = vi.fn().mockResolvedValue("not json");
    await expect(readReadyIssues(run, "corekraft/kore")).rejects.toThrow(
      "gh returned an unreadable issue search; rerun the command.",
    );
  });
});
