import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrView } from "./checks.js";
import { JudgeError } from "./errors.js";
import { ReviewRun, type ReviewPorts } from "./review-run.js";
import { postReview, type ReviewPosted } from "./review-post.js";
import { readVerdict } from "./review-verdict-read.js";
import type { Sender } from "../sender/index.js";

vi.mock("./review-post.js", () => ({
  postReview:
    vi.fn<
      (
        request: { pr: number; findings: readonly string[]; dryRun: boolean },
        view: PrView,
        comment: (body: string) => Promise<string>,
      ) => Promise<ReviewPosted>
    >(),
}));
vi.mock("./review-verdict-read.js", () => ({
  readVerdict: vi.fn<(text: string) => string[] | undefined>(),
}));

const HEAD_A = "aaaaaaaa11111111aaaaaaaa11111111aaaaaaaa";
const WHO: Sender = { command: "review run" };
const HEAD_B = "bbbbbbbb22222222bbbbbbbb22222222bbbbbbbb";
const view = (headSha: string): PrView => ({
  baseSha: "",
  body: "",
  comments: [],
  headCommittedAt: undefined,
  headSha,
  rollup: [],
});
const posted = (head: string, wrote = true): ReviewPosted => ({
  pr: 42,
  head: head.slice(0, 8),
  verdict: "No violations.",
  count: 0,
  body: "BODY",
  posted: wrote,
  ...(wrote ? { url: "https://example.test/c" } : {}),
});

function ports() {
  return {
    view: vi.fn<ReviewPorts["view"]>(),
    comment: vi.fn<ReviewPorts["comment"]>(),
    spawn: vi.fn<ReviewPorts["spawn"]>(),
    wait: vi.fn<ReviewPorts["wait"]>(),
    read: vi.fn<ReviewPorts["read"]>(),
    close: vi.fn<ReviewPorts["close"]>(),
    record: vi.fn<ReviewPorts["record"]>(),
  };
}

let io: ReturnType<typeof ports>;
beforeEach(() => {
  vi.resetAllMocks();
  io = ports();
  io.wait.mockResolvedValue({ outcome: "done", paneId: "p1" });
  io.read.mockResolvedValue("PANE");
  vi.mocked(readVerdict).mockReturnValue([]);
  vi.mocked(postReview).mockResolvedValue(posted(HEAD_A));
});

describe("ReviewRun reviews one PR head and posts the verdict for it", () => {
  it("spawns the Reviewer for the PR, reads its pane, closes it and posts the verdict for the head it read", async () => {
    io.view.mockResolvedValue(view(HEAD_A));
    const done = await new ReviewRun(io).run(42, WHO);
    expect(io.spawn).toHaveBeenCalledExactlyOnceWith(
      "pr42-reviewer",
      expect.stringContaining("42"),
    );
    expect(io.wait).toHaveBeenCalledWith("pr42-reviewer");
    expect(io.read).toHaveBeenCalledWith("p1");
    expect(io.close).toHaveBeenCalledWith("pr42-reviewer");
    expect(postReview).toHaveBeenCalledExactlyOnceWith(
      { pr: 42, findings: [], dryRun: false, sender: WHO },
      view(HEAD_A),
      expect.any(Function),
    );
    expect(done).toEqual({ pr: 42, head: "aaaaaaaa", posted: true, runs: 1 });
    expect(io.record).toHaveBeenCalledExactlyOnceWith(42, "posted:aaaaaaaa");
  });

  it("tells the Reviewer the head to review and the form its verdict takes, and never to post", async () => {
    io.view.mockResolvedValue(view(HEAD_A));
    await new ReviewRun(io).run(42, WHO);
    const brief = io.spawn.mock.calls[0]?.[1] ?? "";
    expect(brief).toContain("aaaaaaaa");
    expect(brief).toContain("VERDICT: none");
    expect(brief).toContain("VERDICT: findings");
    expect(brief).toContain("END VERDICT");
    expect(brief).toMatch(/do not post/i);
    // A line that is only a marker would be read as a verdict from the brief itself.
    expect(brief.split("\n")).toHaveLength(1);
  });

  it("posts the findings the pane gave", async () => {
    io.view.mockResolvedValue(view(HEAD_A));
    vi.mocked(readVerdict).mockReturnValue(["a.ts:1 | rule | wrong | fix"]);
    await new ReviewRun(io).run(42, WHO);
    expect(vi.mocked(postReview).mock.calls[0]?.[0].findings).toEqual([
      "a.ts:1 | rule | wrong | fix",
    ]);
  });

  it("writes the comment through the port for this PR", async () => {
    io.view.mockResolvedValue(view(HEAD_A));
    io.comment.mockResolvedValue("URL");
    vi.mocked(postReview).mockImplementation(async (_r, _v, comment) => {
      await comment("BODY");
      return posted(HEAD_A);
    });
    await new ReviewRun(io).run(42, WHO);
    expect(io.comment).toHaveBeenCalledExactlyOnceWith(42, "BODY");
  });

  it("records an unchanged verdict as nothing posted", async () => {
    io.view.mockResolvedValue(view(HEAD_A));
    vi.mocked(postReview).mockResolvedValue(posted(HEAD_A, false));
    const done = await new ReviewRun(io).run(42, WHO);
    expect(done.posted).toBe(false);
    expect(io.record).toHaveBeenCalledWith(42, "unchanged:aaaaaaaa");
  });
});

describe("ReviewRun never posts a verdict for a head it did not review", () => {
  it("discards the verdict and reviews again when the head moved mid-review", async () => {
    io.view
      .mockResolvedValueOnce(view(HEAD_A))
      .mockResolvedValueOnce(view(HEAD_B))
      .mockResolvedValueOnce(view(HEAD_B))
      .mockResolvedValueOnce(view(HEAD_B));
    vi.mocked(postReview).mockResolvedValue(posted(HEAD_B));
    const done = await new ReviewRun(io).run(42, WHO);
    expect(io.spawn).toHaveBeenCalledTimes(2);
    expect(postReview).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      view(HEAD_B),
      expect.any(Function),
    );
    expect(done).toMatchObject({ head: "bbbbbbbb", runs: 2 });
    expect(io.record).toHaveBeenNthCalledWith(1, 42, "rerun:aaaaaaaa");
    expect(io.record).toHaveBeenNthCalledWith(2, 42, "posted:bbbbbbbb");
  });

  it("gives up after the head moves on every run, posting nothing", async () => {
    let n = 0;
    io.view.mockImplementation(async () =>
      view(`${String(n++).padStart(8, "0")}${"0".repeat(32)}`),
    );
    await expect(new ReviewRun(io, 2).run(42, WHO)).rejects.toThrow(
      /moved .* every review/s,
    );
    expect(postReview).not.toHaveBeenCalled();
    expect(io.spawn).toHaveBeenCalledTimes(2);
    expect(io.close).toHaveBeenCalledTimes(2);
  });
});

describe("ReviewRun records a failure and posts nothing when there is no verdict", () => {
  beforeEach(() => {
    io.view.mockResolvedValue(view(HEAD_A));
  });

  it("fails when the pane has no parsable verdict, and says how to rerun", async () => {
    vi.mocked(readVerdict).mockReturnValue(undefined);
    const run = new ReviewRun(io).run(42, WHO);
    await expect(run).rejects.toThrow(JudgeError);
    await expect(run).rejects.toThrow(/harness review run 42/);
    expect(postReview).not.toHaveBeenCalled();
    expect(io.record).toHaveBeenCalledWith(42, "failed:no verdict");
    expect(io.close).toHaveBeenCalledWith("pr42-reviewer");
  });

  it("fails when the Reviewer ends blocked, without reading a verdict from its pane", async () => {
    io.wait.mockResolvedValue({ outcome: "blocked", paneId: "p1" });
    await expect(new ReviewRun(io).run(42, WHO)).rejects.toThrow(/blocked/);
    expect(postReview).not.toHaveBeenCalled();
    expect(io.record).toHaveBeenCalledWith(42, "failed:blocked");
    expect(io.close).toHaveBeenCalledWith("pr42-reviewer");
  });

  it("closes the pane even when reading it fails", async () => {
    io.read.mockRejectedValue(new Error("herdr gone"));
    await expect(new ReviewRun(io).run(42, WHO)).rejects.toThrow(/herdr gone/);
    expect(io.close).toHaveBeenCalledWith("pr42-reviewer");
    expect(postReview).not.toHaveBeenCalled();
  });
});
