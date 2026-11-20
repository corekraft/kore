import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../runtime/index.js";
import { mergedPrsByIssue, mergedPullRequests } from "./queue-gh.js";

const ROOT = "/repo";
const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });

function context(answer: (args: string[]) => unknown) {
  const run = vi.fn((_command: string, args: string[]) =>
    Promise.resolve(answer(args)),
  );
  return {
    run,
    context: {
      deps: { runner: { run } },
    } as unknown as CommandContext,
  };
}

describe("mergedPrsByIssue", () => {
  it("maps a ticket to the PR that refers to it, once that PR has merged", () => {
    expect(
      mergedPrsByIssue([
        { number: 1234, body: "Refs #20", mergedAt: "2026-11-19T10:00:00Z" },
      ]),
    ).toEqual(new Map([[20, 1234]]));
  });

  it("leaves out a ticket whose newest referring PR is still open", () => {
    expect(
      mergedPrsByIssue([
        { number: 1200, body: "Refs #20", mergedAt: "2026-11-18T10:00:00Z" },
        { number: 1250, body: "Refs #20", mergedAt: null },
      ]),
    ).toEqual(new Map());
  });

  it("reads every issue a PR refers to", () => {
    expect(
      mergedPrsByIssue([
        { number: 1234, body: "Refs #20 and Refs #21", mergedAt: "x" },
      ]),
    ).toEqual(
      new Map([
        [20, 1234],
        [21, 1234],
      ]),
    );
  });
});

describe("mergedPullRequests", () => {
  it("lists every PR in the repository and maps the merged ones to their tickets", async () => {
    const c = context(() =>
      ok(
        JSON.stringify([
          { number: 1234, body: "Refs #20", mergedAt: "2026-11-19T10:00:00Z" },
        ]),
      ),
    );

    expect(await mergedPullRequests(c.context, "corekraft/kore", ROOT)).toEqual(
      new Map([[20, 1234]]),
    );
    expect(c.run).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["pr", "list", "--state", "all"]),
      { cwd: ROOT },
    );
  });
});
