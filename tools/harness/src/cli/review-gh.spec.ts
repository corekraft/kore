import { describe, expect, it, vi } from "vitest";
import { JudgeError, readPr } from "../judge/index.js";
import type { CommandContext, Runner } from "../runtime/index.js";
import type { Ledger } from "../ledger/index.js";
import { openJudgeLedger, repoOf } from "./judge-shared.js";
import { ghReviewIo } from "./review-gh.js";

// The judge barrel is mocked, so no judge module graph loads here. JudgeError is a local
// stand-in class: the port and the spec both see the same one through the mock.
vi.mock("../judge/index.js", () => {
  class ErrorStandIn extends Error {}
  return {
    JudgeError: ErrorStandIn,
    readPr: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  };
});
vi.mock("./judge-shared.js", () => ({
  repoOf: vi.fn<(context: CommandContext) => Promise<string>>(),
  openJudgeLedger: vi.fn<(context: CommandContext) => Promise<Ledger>>(),
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

describe("the review port records a posted verdict as a review.run event", () => {
  const NOW = new Date("2026-11-17T10:00:00.000Z");

  function recorder(result: unknown = { ok: true }) {
    const record = vi.fn<(event: unknown) => Promise<unknown>>();
    record.mockResolvedValue(result);
    vi.mocked(openJudgeLedger).mockResolvedValue({
      record,
    } as unknown as Ledger);
    vi.mocked(repoOf).mockResolvedValue(REPO);
    const { context } = contextWith(ok(""));
    (context.deps as unknown as { clock: { now: () => Date } }).clock = {
      now: () => NOW,
    };
    return { context, record };
  }

  it("writes the posted:<head> label the flow report reads, with the count and the rule labels", async () => {
    const { context, record } = recorder();
    const io = await ghReviewIo(context);
    await io.record(42, "abc1234d", 2, ["pin-everything", "scope"]);
    expect(record).toHaveBeenCalledExactlyOnceWith({
      source: "claude",
      kind: "review.run",
      occurredAt: "2026-11-17T10:00:00.000Z",
      number: 42,
      label: "posted:abc1234d",
      stage: "review",
      findings: 2,
      rules: "pin-everything,scope",
    });
  });

  it("leaves the rules field out for a verdict that cites none", async () => {
    const { context, record } = recorder();
    const io = await ghReviewIo(context);
    await io.record(42, "abc1234d", 0, []);
    expect(record).toHaveBeenCalledExactlyOnceWith({
      source: "claude",
      kind: "review.run",
      occurredAt: "2026-11-17T10:00:00.000Z",
      number: 42,
      label: "posted:abc1234d",
      stage: "review",
      findings: 0,
    });
  });

  it("refuses with the ledger's reason, saying the verdict is posted and how to record it", async () => {
    const { context } = recorder({ ok: false, message: "Invalid event." });
    const io = await ghReviewIo(context);
    await expect(io.record(42, "abc1234d", 0, [])).rejects.toThrow(JudgeError);
    await expect(io.record(42, "abc1234d", 0, [])).rejects.toThrow(
      "The verdict on PR #42 is posted, but its review.run event was rejected: Invalid event. Fix the ledger and record the event by hand with `harness ledger record`; rerunning `review post` posts nothing and records nothing.",
    );
  });
});
