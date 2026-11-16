import { describe, expect, it, vi } from "vitest";
import { JudgeError, summary } from "../judge/index.js";
import {
  checkedPrecheck,
  failed,
  prNumber,
  record,
  repoOf,
  reviewersOf,
} from "./judge-shared.js";
import { mergeCommands } from "./judge-merge-commands.js";
import { contextOf, REPO, reportOf, ROOT } from "./judge-command-support.js";

vi.mock("../judge/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../judge/index.js")>()),
  summary: vi.fn(),
}));
vi.mock("./judge-shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./judge-shared.js")>()),
  checkedPrecheck: vi.fn(),
  failed: vi.fn(),
  prNumber: vi.fn(),
  record: vi.fn(),
  repoOf: vi.fn(),
  reviewersOf: vi.fn(),
}));

describe("harness judge merge", () => {
  it("re-runs the precheck and squash-merges the head it verified", async () => {
    const { context, run, stdout } = contextOf("42");
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(repoOf).mockResolvedValue(REPO);
    vi.mocked(reviewersOf).mockResolvedValue(["bot"]);
    vi.mocked(checkedPrecheck).mockResolvedValue(reportOf());

    expect(await mergeCommands.merge?.run(context)).toBe(0);
    expect(checkedPrecheck).toHaveBeenCalledWith(context, ROOT, REPO, 42, [
      "bot",
    ]);
    expect(run.mock.calls).toEqual([
      [
        "gh",
        [
          "pr",
          "merge",
          "42",
          "--repo",
          REPO,
          "--squash",
          "--match-head-commit",
          "abc1234",
        ],
        { cwd: ROOT },
      ],
    ]);
    expect(stdout).toHaveBeenCalledWith("PR #42: squash-merged at abc1234\n");
  });

  it("records the precheck verdict before it decides whether to merge", async () => {
    const { context } = contextOf("42");
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(checkedPrecheck).mockResolvedValue(reportOf());

    await mergeCommands.merge?.run(context);
    expect(record).toHaveBeenCalledWith(context, reportOf());
  });

  it("prints the merge as JSON under --json", async () => {
    const { context, stdout } = contextOf("42", {}, true);
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(checkedPrecheck).mockResolvedValue(reportOf());

    await mergeCommands.merge?.run(context);
    expect(stdout).toHaveBeenCalledWith(
      `${JSON.stringify({ pr: 42, merged: true, head: "abc1234" })}\n`,
    );
  });

  it("merges nothing when the precheck does not pass, and says so on stderr", async () => {
    const { context, run, stdout, stderr } = contextOf("42");
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(checkedPrecheck).mockResolvedValue(reportOf({ ok: false }));
    vi.mocked(summary).mockReturnValue("SUMMARY");

    expect(await mergeCommands.merge?.run(context)).toBe(1);
    expect(run).not.toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledWith("SUMMARY");
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining(
        "PR #42 was not merged: the precheck did not pass.",
      ),
    );
  });

  it("merges nothing when the precheck reports no head commit to match", async () => {
    const { context, run } = contextOf("42");
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(checkedPrecheck).mockResolvedValue(reportOf({ head: "" }));

    expect(await mergeCommands.merge?.run(context)).toBe(1);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("harness judge merge: refusals", () => {
  it("reports a refused gh merge with the head to verify again", async () => {
    const { context, run } = contextOf("42");
    run.mockResolvedValue({ code: 1, stdout: "", stderr: "head moved\n" });
    vi.mocked(prNumber).mockReturnValue(42);
    vi.mocked(checkedPrecheck).mockResolvedValue(reportOf());
    vi.mocked(failed).mockReturnValue(1);

    expect(await mergeCommands.merge?.run(context)).toBe(1);
    const [, error] = vi.mocked(failed).mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(JudgeError);
    expect((error as Error).message).toBe(
      "gh pr merge failed for PR #42: head moved. If the head moved, rerun `harness judge merge 42` to verify the new commit.",
    );
  });
});

describe("harness judge merge: a missing PR number", () => {
  it("hands a missing PR number to the shared failure reporter, and merges nothing", async () => {
    const { context, run } = contextOf(undefined);
    const usage = new JudgeError("Missing or invalid PR number.");
    vi.mocked(prNumber).mockImplementation(() => {
      throw usage;
    });
    vi.mocked(failed).mockReturnValue(1);

    expect(await mergeCommands.merge?.run(context)).toBe(1);
    expect(failed).toHaveBeenCalledWith(context, usage);
    expect(run).not.toHaveBeenCalled();
  });
});
