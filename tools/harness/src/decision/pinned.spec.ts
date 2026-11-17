import { describe, expect, it, vi } from "vitest";
import { DecisionError } from "./decision.js";
import { pinnedDigestIssue, type GhRun } from "./pinned.js";

function reply(urls: string[]) {
  return JSON.stringify({
    data: {
      repository: {
        pinnedIssues: { nodes: urls.map((url) => ({ issue: { url } })) },
      },
    },
  });
}

function runReturning(stdout: string, code = 0): GhRun {
  return vi.fn(() => Promise.resolve({ code, stdout, stderr: "" }));
}

describe("pinnedDigestIssue", () => {
  it("reads the one pinned issue's number and repository from its URL", async () => {
    const run = runReturning(
      reply(["https://github.com/corekraft/kore/issues/900"]),
    );

    expect(await pinnedDigestIssue(run)).toEqual({
      number: "900",
      repo: "corekraft/kore",
    });
  });

  it("asks GitHub for the pinned issues of the current repository, not of a named one", async () => {
    const run = runReturning(
      reply(["https://github.com/corekraft/kore/issues/900"]),
    );

    await pinnedDigestIssue(run);

    expect(run).toHaveBeenCalledWith(
      expect.arrayContaining([
        "api",
        "graphql",
        "-F",
        "owner={owner}",
        "-F",
        "name={repo}",
      ]),
    );
  });

  it("refuses, naming the fix, when no issue is pinned, so nothing is posted", async () => {
    await expect(pinnedDigestIssue(runReturning(reply([])))).rejects.toThrow(
      new DecisionError(
        "No issue is pinned for the owner digest. Pin the one issue the digest should post to, then rerun.",
      ),
    );
  });

  it("refuses when more than one issue is pinned, since the digest needs exactly one", async () => {
    await expect(
      pinnedDigestIssue(
        runReturning(
          reply([
            "https://github.com/corekraft/kore/issues/900",
            "https://github.com/corekraft/kore/issues/901",
          ]),
        ),
      ),
    ).rejects.toThrow(
      "2 issues are pinned for the owner digest. Unpin all but one, then rerun.",
    );
  });

  it("refuses with gh's reason when the GraphQL read fails", async () => {
    const run: GhRun = vi.fn(() =>
      Promise.resolve({ code: 1, stdout: "", stderr: "HTTP 401" }),
    );

    await expect(pinnedDigestIssue(run)).rejects.toThrow(
      "Reading the pinned issues failed: HTTP 401. Check `gh auth status`, then rerun the same command.",
    );
  });

  it("refuses a pinned URL it cannot read as an issue of a repository", async () => {
    await expect(
      pinnedDigestIssue(
        runReturning(reply(["https://example.com/not-an-issue"])),
      ),
    ).rejects.toThrow(DecisionError);
  });
});
