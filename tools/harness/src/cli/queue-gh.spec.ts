import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../runtime/index.js";
import { QueueError } from "./queue-error.js";
import { approvedIssues, gh, openPullRequests, repoName } from "./queue-gh.js";

const ROOT = "/repo";
const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });

/** A command context whose runner answers each call through `answer`. */
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

describe("gh", () => {
  it("runs gh in the checkout and returns its stdout", async () => {
    const c = context(() => ok("[]"));
    expect(await gh(c.context, ["pr", "list"], ROOT)).toBe("[]");
    expect(c.run).toHaveBeenCalledWith("gh", ["pr", "list"], { cwd: ROOT });
  });

  it("fails naming the call and the stderr, with the auth fix", async () => {
    const c = context(() => ({
      code: 1,
      stdout: "",
      stderr: "not logged in\n",
    }));
    await expect(
      gh(c.context, ["issue", "list", "--json"], ROOT),
    ).rejects.toThrow(
      new QueueError(
        "gh issue list failed: not logged in. Check `gh auth status`, then rerun.",
      ),
    );
  });
});

describe("repoName", () => {
  it("returns the repository gh names for the checkout", async () => {
    const c = context(() => ok('{"nameWithOwner":"corekraft/kore"}'));
    expect(await repoName(c.context, ROOT)).toBe("corekraft/kore");
  });

  it("fails telling the user to run inside the repository when gh names none", async () => {
    const c = context(() => ok("{}"));
    await expect(repoName(c.context, ROOT)).rejects.toThrow(
      "gh could not tell which repository this is; run it inside the repository.",
    );
  });
});

describe("approvedIssues", () => {
  it("lists the approved issues by number, with their creation time, and skips rows that lack either", async () => {
    const c = context(() =>
      ok(
        '[{"number":10,"createdAt":"2026-01-05T00:00:00Z"},{"number":"x"},{"number":11,"createdAt":"2026-01-02T00:00:00Z"}]',
      ),
    );
    expect(await approvedIssues(c.context, "corekraft/kore", ROOT)).toEqual(
      new Map([
        [10, "2026-01-05T00:00:00Z"],
        [11, "2026-01-02T00:00:00Z"],
      ]),
    );
    expect(c.run.mock.calls[0]?.[1]).toEqual([
      "issue",
      "list",
      "--label",
      "ready-for-agent",
      "--state",
      "open",
      "--json",
      "number,createdAt",
      "--repo",
      "corekraft/kore",
      "--limit",
      "200",
    ]);
  });

  it("fails naming the issue list when gh returns something that is not a list", async () => {
    const c = context(() => ok("not json"));
    await expect(
      approvedIssues(c.context, "corekraft/kore", ROOT),
    ).rejects.toThrow("gh returned unreadable issue list; rerun the command.");
  });
});

describe("openPullRequests", () => {
  it("lists each open PR with the head commit it is at, skipping rows that lack either", async () => {
    const c = context(() =>
      ok('[{"number":50,"headRefOid":"aaaaaaa999"},{"number":"x"},7]'),
    );
    expect(await openPullRequests(c.context, "corekraft/kore", ROOT)).toEqual([
      { number: 50, head: "aaaaaaa999" },
    ]);
  });
});
