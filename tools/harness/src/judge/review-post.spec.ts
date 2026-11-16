import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrComment, PrView } from "./checks.js";
import { postReview, type ReviewRequest } from "./review-post.js";
import { reviewBody, verdictText } from "./review-verdict.js";
import { formatSender, withoutSender, type Sender } from "../sender/index.js";

vi.mock("./review-verdict.js", () => ({
  VERDICT_HEAD_LENGTH: 8,
  reviewBody: vi.fn<(headSha: string, findings: readonly string[]) => string>(),
  verdictText: vi.fn<(count: number) => string>(),
}));
vi.mock("../sender/index.js", () => ({
  formatSender: vi.fn<(sender: Sender) => string>(),
  withoutSender: vi.fn<(body: string) => string>(),
}));

const HEAD = "abc1234def5678abc1234def5678abc1234def56";
const URL = "https://github.com/corekraft/kore/pull/42#issuecomment-1";
const BODY = "BODY for the head";
const SENDER = "sender: writer fix-x (review post)";
const SENT = `${SENDER}\n${BODY}`;
const WHO: Sender = {
  command: "review post",
  session: { role: "writer", name: "fix-x" },
};

const view = (comments: PrComment[] = []): PrView => ({
  baseSha: "",
  body: "",
  comments,
  headCommittedAt: undefined,
  headSha: HEAD,
  rollup: [],
});

const comment = (body: string): PrComment => ({
  body,
  author: "reviewer-bot",
  createdAt: "2026-11-14T10:00:00Z",
});

const request = (findings: string[] = [], dryRun = false): ReviewRequest => ({
  pr: 42,
  findings,
  dryRun,
  sender: WHO,
});

/** The formatter's answers: the body for the head, and the words for a count. */
function formatter(words: string) {
  vi.mocked(reviewBody).mockReturnValue(BODY);
  vi.mocked(verdictText).mockReturnValue(words);
}

beforeEach(() => {
  vi.mocked(formatSender).mockReturnValue(SENDER);
  vi.mocked(withoutSender).mockImplementation((body) => body);
});

describe("postReview posts the formatted verdict once per head", () => {
  it("formats the verdict for the head and posts it, returning the comment URL", async () => {
    formatter("No violations.");
    const post = vi.fn<(body: string) => Promise<string>>();
    post.mockResolvedValue(URL);
    const done = await postReview(request(), view(), post);
    expect(reviewBody).toHaveBeenCalledWith(HEAD, []);
    expect(post).toHaveBeenCalledExactlyOnceWith(SENT);
    expect(done).toEqual({
      pr: 42,
      head: "abc1234d",
      verdict: "No violations.",
      count: 0,
      body: SENT,
      posted: true,
      url: URL,
    });
  });

  it("starts the posted verdict with the sender line for the request's sender", async () => {
    formatter("No violations.");
    const post = vi.fn<(body: string) => Promise<string>>();
    post.mockResolvedValue(URL);
    await postReview(request(), view(), post);
    expect(formatSender).toHaveBeenCalledWith(WHO);
    expect(post.mock.calls[0]?.[0].split("\n")[0]).toBe(SENDER);
  });

  it("reports the count of findings as the verdict's words", async () => {
    formatter("2 violations");
    const post = vi.fn<(body: string) => Promise<string>>();
    post.mockResolvedValue(URL);
    const done = await postReview(request(["one", "two"]), view(), post);
    expect(verdictText).toHaveBeenCalledWith(2);
    expect(done.verdict).toBe("2 violations");
    expect(done.count).toBe(2);
  });
});

describe("postReview does not post the same verdict twice on a head", () => {
  it("posts nothing when a comment on this head already carries the same body", async () => {
    formatter("No violations.");
    const post = vi.fn<(body: string) => Promise<string>>();
    const done = await postReview(
      request(),
      view([comment(` ${BODY}\n`)]),
      post,
    );
    expect(post).not.toHaveBeenCalled();
    expect(done.posted).toBe(false);
    expect(done.url).toBeUndefined();
  });

  it("posts nothing when the same verdict is already on the head behind a sender line", async () => {
    formatter("No violations.");
    vi.mocked(withoutSender).mockImplementation((body) =>
      body.startsWith(`${SENDER}\n`) ? body.slice(SENDER.length + 1) : body,
    );
    const post = vi.fn<(body: string) => Promise<string>>();
    const done = await postReview(request(), view([comment(SENT)]), post);
    expect(post).not.toHaveBeenCalled();
    expect(done.posted).toBe(false);
  });

  it("posts again when the comments on the PR carry a different body", async () => {
    formatter("No violations.");
    const post = vi.fn<(body: string) => Promise<string>>();
    post.mockResolvedValue(URL);
    const done = await postReview(
      request(),
      view([comment("principles-review: 3 violations (head 00000000)")]),
      post,
    );
    expect(post).toHaveBeenCalledOnce();
    expect(done.posted).toBe(true);
  });

  it("returns the sent body and makes no comment call on a dry run", async () => {
    formatter("1 violations");
    const post = vi.fn<(body: string) => Promise<string>>();
    const done = await postReview(request(["one"], true), view(), post);
    expect(post).not.toHaveBeenCalled();
    expect(done.posted).toBe(false);
    expect(done.body).toBe(SENT);
    expect(done.url).toBeUndefined();
  });
});
