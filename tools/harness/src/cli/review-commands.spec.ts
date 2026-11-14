import { describe, expect, it, vi } from "vitest";
import {
  findingsFrom,
  postReview,
  type PrView,
  type ReviewPosted,
} from "../judge/index.js";
import type { CommandContext } from "../runtime/index.js";
import { failed, prNumber } from "./judge-shared.js";
import { reviewCommands, reviewPostRun } from "./review-commands.js";
import { ghReviewIo, type ReviewIo } from "./review-gh.js";

vi.mock("./review-gh.js", () => ({
  ghReviewIo: vi.fn<(context: CommandContext) => Promise<ReviewIo>>(),
}));

vi.mock("../judge/index.js", () => ({
  findingsFrom: vi.fn<(stdin: string, none: boolean) => string[]>(),
  postReview:
    vi.fn<
      (
        request: { pr: number; findings: readonly string[]; dryRun: boolean },
        view: PrView,
        comment: (body: string) => Promise<string>,
      ) => Promise<ReviewPosted>
    >(),
}));
vi.mock("./judge-shared.js", () => ({
  prNumber: vi.fn<(operand: string | undefined, usage: string) => number>(),
  failed: vi.fn<(context: CommandContext, error: unknown) => number>(),
  repoOf: vi.fn(),
}));

const URL = "https://github.com/corekraft/kore/pull/42#issuecomment-1";
const VIEW = { headSha: "abc1234def5678" } as unknown as PrView;

const posted = (over: Partial<ReviewPosted> = {}): ReviewPosted => ({
  pr: 42,
  head: "abc1234d",
  verdict: "No violations.",
  count: 0,
  body: "principles-review: No violations. (head abc1234d)",
  posted: true,
  url: URL,
  ...over,
});

/** A record the domain did not post: no URL key at all, as the domain returns it. */
const unposted = (): ReviewPosted => ({
  pr: 42,
  head: "abc1234d",
  verdict: "No violations.",
  count: 0,
  body: "principles-review: No violations. (head abc1234d)",
  posted: false,
});

function fixture(
  options: Record<string, string | boolean>,
  stdin: string,
  json = false,
) {
  const stdout = vi.fn<(text: string) => void>();
  const stderr = vi.fn<(text: string) => void>();
  const io = {
    view: vi.fn<(pr: number) => Promise<PrView>>(),
    comment: vi.fn<(pr: number, body: string) => Promise<string>>(),
  };
  const load = vi.fn<() => Promise<ReviewIo>>();
  load.mockResolvedValue(io as unknown as ReviewIo);
  io.view.mockResolvedValue(VIEW);
  const context = {
    operand: "42",
    options,
    json,
    deps: { stdin: () => Promise.resolve(stdin), stdout, stderr },
  } as unknown as CommandContext;
  vi.mocked(prNumber).mockReturnValue(42);
  return { context, stdout, stderr, io, load };
}

describe("harness review post posts the verdict the domain formats", () => {
  it("reads the PR's head through the port, posts the verdict, and reports the URL", async () => {
    const f = fixture({ none: true }, "");
    vi.mocked(findingsFrom).mockReturnValue([]);
    vi.mocked(postReview).mockResolvedValue(posted());
    expect(await reviewPostRun(f.context, f.load)).toBe(0);
    expect(f.io.view).toHaveBeenCalledWith(42);
    expect(postReview).toHaveBeenCalledWith(
      { pr: 42, findings: [], dryRun: false },
      VIEW,
      expect.any(Function),
    );
    expect(f.stdout).toHaveBeenCalledWith(
      `PR #42: posted principles-review: No violations. (head abc1234d) at ${URL}\n`,
    );
  });

  it("passes the stdin and --none to findingsFrom", async () => {
    const f = fixture({ none: true }, "a finding");
    vi.mocked(findingsFrom).mockReturnValue([]);
    vi.mocked(postReview).mockResolvedValue(posted());
    await reviewPostRun(f.context, f.load);
    expect(findingsFrom).toHaveBeenCalledWith("a finding", true);
  });

  it("returns the posted record as JSON under --json", async () => {
    const f = fixture({ none: true }, "", true);
    vi.mocked(findingsFrom).mockReturnValue([]);
    vi.mocked(postReview).mockResolvedValue(posted());
    expect(await reviewPostRun(f.context, f.load)).toBe(0);
    expect(f.stdout).toHaveBeenCalledWith(`${JSON.stringify(posted())}\n`);
  });
});

describe("harness review post is safe to preview and to rerun", () => {
  it("prints the exact body and asks the domain for a dry run", async () => {
    const f = fixture({ "dry-run": true, none: true }, "");
    vi.mocked(findingsFrom).mockReturnValue([]);
    vi.mocked(postReview).mockResolvedValue(unposted());
    expect(await reviewPostRun(f.context, f.load)).toBe(0);
    expect(postReview).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
      VIEW,
      expect.any(Function),
    );
    expect(f.stdout).toHaveBeenCalledWith(
      "principles-review: No violations. (head abc1234d)\n",
    );
  });

  it("says nothing new was posted when the domain finds the verdict already on the head", async () => {
    const f = fixture({ none: true }, "");
    vi.mocked(findingsFrom).mockReturnValue([]);
    vi.mocked(postReview).mockResolvedValue(unposted());
    expect(await reviewPostRun(f.context, f.load)).toBe(0);
    expect(f.stdout).toHaveBeenCalledWith(
      "PR #42: principles-review: No violations. (head abc1234d) is already on this head; nothing posted\n",
    );
  });
});

describe("harness review post refuses before any gh call", () => {
  it("hands a refused verdict to the failure reporter, reads no PR and loads no port", async () => {
    const f = fixture({ none: true }, "a finding");
    const refusal = new Error("refused");
    vi.mocked(findingsFrom).mockImplementation(() => {
      throw refusal;
    });
    vi.mocked(failed).mockReturnValue(1);
    expect(await reviewPostRun(f.context, f.load)).toBe(1);
    expect(failed).toHaveBeenCalledWith(f.context, refusal);
    expect(f.load).not.toHaveBeenCalled();
    expect(f.io.view).not.toHaveBeenCalled();
    expect(postReview).not.toHaveBeenCalled();
  });

  it("reports a missing PR number before it reads the findings", async () => {
    const f = fixture({ none: true }, "");
    const missing = new Error("Missing or invalid PR number.");
    vi.mocked(prNumber).mockImplementation(() => {
      throw missing;
    });
    vi.mocked(failed).mockReturnValue(1);
    expect(await reviewPostRun(f.context, f.load)).toBe(1);
    expect(failed).toHaveBeenCalledWith(f.context, missing);
    expect(findingsFrom).not.toHaveBeenCalled();
  });
});

describe("harness review post wires the GitHub port into the command", () => {
  it("comments through the port with the PR number the verdict is posted for", async () => {
    const f = fixture({ none: true }, "");
    vi.mocked(findingsFrom).mockReturnValue([]);
    vi.mocked(postReview).mockImplementation(
      async (_request, _view, comment) => {
        await comment("principles-review: No violations. (head abc1234d)");
        return posted();
      },
    );
    expect(await reviewPostRun(f.context, f.load)).toBe(0);
    expect(f.io.comment).toHaveBeenCalledWith(
      42,
      "principles-review: No violations. (head abc1234d)",
    );
  });

  it("loads the real GitHub port for the context it was run with", async () => {
    const f = fixture({ none: true }, "");
    vi.mocked(findingsFrom).mockReturnValue([]);
    vi.mocked(postReview).mockResolvedValue(posted());
    vi.mocked(ghReviewIo).mockResolvedValue(f.io as unknown as ReviewIo);
    expect(await reviewCommands["post"]?.run(f.context)).toBe(0);
    expect(ghReviewIo).toHaveBeenCalledWith(f.context);
  });
});
