import { describe, expect, it, vi } from "vitest";
import { JudgeError } from "../judge/errors.js";
import { readPr } from "../judge/index.js";
import type { CommandContext, Runner } from "../runtime/index.js";
import { repoOf } from "./judge-shared.js";
import { ghReviewIo } from "./review-gh.js";

// The error class is real; the PR reader is mocked, so no judge module graph loads here.
vi.mock("../judge/index.js", async () => ({
  JudgeError: (await import("../judge/errors.js")).JudgeError,
  readPr: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("./judge-shared.js", () => ({
  repoOf: vi.fn<(context: CommandContext) => Promise<string>>(),
}));

const REPO = "corekraft/kore";
const ROOT = "/repo";
const URL = "https://github.com/corekraft/kore/pull/42#issuecomment-9";
const BODY = "principles-review: No violations. (head abc1234d)";

function contextWith(answer: Runner["run"]) {
  const run = vi.fn<Runner["run"]>(answer);
  const context = {
    deps: { root: () => Promise.resolve(ROOT), runner: { run } },
  } as unknown as CommandContext;
  return { context, run };
}

const ok = (stdout: string) => () =>
  Promise.resolve({ stdout, stderr: "", code: 0 });

describe("the review port reads and comments the PR on the bundle's repository", () => {
  it("reads the PR through the named repository and the repo root", async () => {
    vi.mocked(repoOf).mockResolvedValue(REPO);
    vi.mocked(readPr).mockResolvedValue({ headSha: "x" } as never);
    const { context } = contextWith(ok(""));
    const io = await ghReviewIo(context);
    expect(await io.view(42)).toEqual({ headSha: "x" });
    expect(readPr).toHaveBeenCalledWith(context, ROOT, REPO, 42);
  });

  it("comments the body on the named repository and returns the URL gh prints", async () => {
    vi.mocked(repoOf).mockResolvedValue(REPO);
    const { context, run } = contextWith(ok(`${URL}\n`));
    const io = await ghReviewIo(context);
    expect(await io.comment(42, BODY)).toBe(URL);
    expect(run).toHaveBeenCalledExactlyOnceWith(
      "gh",
      ["pr", "comment", "42", "--repo", REPO, "--body", BODY],
      { cwd: ROOT },
    );
  });

  it("refuses a failed comment with the PR and the fix, and returns no URL", async () => {
    vi.mocked(repoOf).mockResolvedValue(REPO);
    const { context } = contextWith(() =>
      Promise.resolve({ stdout: "", stderr: "not found", code: 1 }),
    );
    const io = await ghReviewIo(context);
    await expect(io.comment(42, BODY)).rejects.toThrow(JudgeError);
    await expect(io.comment(42, BODY)).rejects.toThrow(
      "gh pr comment failed for PR #42: not found. Check `gh auth status` and the PR number, then rerun `harness review post 42`.",
    );
  });
});
