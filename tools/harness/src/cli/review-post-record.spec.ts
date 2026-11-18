import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findingsFrom,
  postReview,
  ruleLabels,
  type PrView,
  type ReviewPosted,
} from "../judge/index.js";
import type { CommandContext } from "../runtime/index.js";
import { senderFrom, type Sender } from "../sender/index.js";
import { failed, prNumber } from "./judge-shared.js";
import { reviewPostRun } from "./review-commands.js";
import type { ReviewIo } from "./review-gh.js";

vi.mock("./review-gh.js", () => ({ ghReviewIo: vi.fn() }));
vi.mock("./review-resample-command.js", () => ({ reviewResampleRun: vi.fn() }));
vi.mock("./review-resample-io.js", () => ({ sessionResampleIo: vi.fn() }));
vi.mock("./review-run-command.js", () => ({ reviewRunRun: vi.fn() }));
vi.mock("../judge/index.js", () => ({
  JudgeError: class extends Error {},
  findingsFrom: vi.fn<(stdin: string, none: boolean) => string[]>(),
  ruleLabels: vi.fn<(findings: readonly string[]) => string[]>(),
  postReview: vi.fn<(...args: unknown[]) => Promise<ReviewPosted>>(),
}));
vi.mock("../sender/index.js", () => ({
  senderFrom: vi.fn<(...args: unknown[]) => Sender>(),
}));
vi.mock("./judge-shared.js", () => ({
  prNumber: vi.fn<(operand: string | undefined, usage: string) => number>(),
  failed: vi.fn<(context: CommandContext, error: unknown) => number>(),
}));

const URL = "https://github.com/corekraft/kore/pull/42#issuecomment-1";
const FINDINGS = ["a:1 | Pin everything | x | y", "b:2 | Scope | x | y"];

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

function fixture(options: Record<string, string | boolean>) {
  const record =
    vi.fn<
      (
        pr: number,
        head: string,
        count: number,
        rules: readonly string[],
      ) => Promise<void>
    >();
  const io = {
    view: vi.fn<(pr: number) => Promise<PrView>>().mockResolvedValue({
      headSha: "abc1234def5678",
    } as unknown as PrView),
    comment: vi.fn<(pr: number, body: string) => Promise<string>>(),
    record,
  };
  const context = {
    operand: "42",
    options,
    json: false,
    deps: {
      stdin: () => Promise.resolve(""),
      stdout: vi.fn<(text: string) => void>(),
      env: {},
    },
  } as unknown as CommandContext;
  return { context, io, load: () => Promise.resolve(io as ReviewIo) };
}

beforeEach(() => {
  vi.mocked(prNumber).mockReturnValue(42);
  vi.mocked(senderFrom).mockReturnValue({ command: "review post" });
  vi.mocked(findingsFrom).mockReturnValue([]);
  vi.mocked(ruleLabels).mockReturnValue([]);
});

describe("harness review post records the verdict it posted in the ledger", () => {
  it("records the PR, the head, the count and the cited rule labels once, and no finding text", async () => {
    const f = fixture({});
    vi.mocked(findingsFrom).mockReturnValue(FINDINGS);
    vi.mocked(ruleLabels).mockReturnValue(["pin-everything", "scope"]);
    vi.mocked(postReview).mockResolvedValue(
      posted({ count: 2, verdict: "2 violations" }),
    );
    expect(await reviewPostRun(f.context, f.load)).toBe(0);
    expect(ruleLabels).toHaveBeenCalledWith(FINDINGS);
    expect(f.io.record).toHaveBeenCalledExactlyOnceWith(42, "abc1234d", 2, [
      "pin-everything",
      "scope",
    ]);
  });

  it("records a count of zero and no labels for a verdict with no violations", async () => {
    const f = fixture({ none: true });
    vi.mocked(postReview).mockResolvedValue(posted());
    await reviewPostRun(f.context, f.load);
    expect(f.io.record).toHaveBeenCalledExactlyOnceWith(42, "abc1234d", 0, []);
  });

  it("records the same for a verdict whose comment begins with the sender line", async () => {
    const f = fixture({ none: true });
    vi.mocked(postReview).mockResolvedValue(
      posted({
        body: "sender: writer fix-x (review post)\nprinciples-review: No violations. (head abc1234d)",
      }),
    );
    await reviewPostRun(f.context, f.load);
    expect(f.io.record).toHaveBeenCalledExactlyOnceWith(42, "abc1234d", 0, []);
  });

  it("records nothing when the identical verdict is already on the head", async () => {
    const f = fixture({ none: true });
    const { url: _url, ...already } = posted({ posted: false });
    vi.mocked(postReview).mockResolvedValue(already);
    expect(await reviewPostRun(f.context, f.load)).toBe(0);
    expect(f.io.record).not.toHaveBeenCalled();
  });

  it("records nothing on a dry run", async () => {
    const f = fixture({ "dry-run": true, none: true });
    vi.mocked(postReview).mockResolvedValue(posted({ posted: false }));
    await reviewPostRun(f.context, f.load);
    expect(f.io.record).not.toHaveBeenCalled();
  });

  it("hands a refused ledger write to the failure reporter", async () => {
    const f = fixture({ none: true });
    vi.mocked(postReview).mockResolvedValue(posted());
    const refusal = new Error("ledger refused");
    f.io.record.mockRejectedValue(refusal);
    vi.mocked(failed).mockReturnValue(1);
    expect(await reviewPostRun(f.context, f.load)).toBe(1);
    expect(failed).toHaveBeenCalledWith(f.context, refusal);
  });
});
