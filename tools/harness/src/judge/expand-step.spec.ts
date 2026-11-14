import { describe, expect, it, vi } from "vitest";
import { expandStepCheck } from "./expand-step-check.js";
import { readExpandStep } from "./expand-step.js";
import type { Api } from "./manifest-source.js";
import { parseExpandPr } from "./parse-expand-pr.js";
import { parseIssueComments } from "./parse-issue-comments.js";

// The reader is one unit: the check and both parsers are mocked, so these tests
// assert what it reads through gh and how it hands that to each collaborator.
vi.mock("./expand-step-check.js");
vi.mock("./parse-expand-pr.js");
vi.mock("./parse-issue-comments.js");

const OWNER = "junners";
const EXPAND_MERGED = "2026-11-14T15:19:20Z";
const HEAD_COMMITTED = "2026-11-14T16:00:00Z";
const PR_VIEW_ARGS = ["pr", "view", "547", "--json", "mergedAt"];
const ISSUE_ARGS = ["issue", "view", "502", "--json", "comments"];
const STEP = {
  pr: 584,
  expandPr: 547,
  idea: "502",
  headCommittedAt: HEAD_COMMITTED,
  reviewers: [OWNER],
};
const COMMENTS = [
  { author: OWNER, body: "Expand proof: #547 ok", createdAt: "t1" },
];

describe("readExpandStep reads the expand PR and the idea's comments through gh", () => {
  it("reads the expand PR and the idea issue through gh, and parses each output", async () => {
    const api = vi
      .fn<Api>()
      .mockResolvedValueOnce("merged-json")
      .mockResolvedValueOnce("issue-json");
    vi.mocked(parseExpandPr).mockReturnValue({ mergedAt: EXPAND_MERGED });
    vi.mocked(parseIssueComments).mockReturnValue(COMMENTS);
    vi.mocked(expandStepCheck).mockReturnValue({ result: "pass" });
    await readExpandStep(api, STEP);
    expect(api).toHaveBeenNthCalledWith(1, PR_VIEW_ARGS);
    expect(api).toHaveBeenNthCalledWith(2, ISSUE_ARGS);
    expect(parseExpandPr).toHaveBeenCalledExactlyOnceWith("merged-json");
    expect(parseIssueComments).toHaveBeenCalledExactlyOnceWith("issue-json");
  });

  it("does not read the idea issue when the idea is not an issue number, and checks with no comments", async () => {
    const api = vi.fn<Api>().mockResolvedValueOnce("merged-json");
    vi.mocked(parseExpandPr).mockReturnValue({ mergedAt: EXPAND_MERGED });
    vi.mocked(expandStepCheck).mockReturnValue({ result: "missing" });
    await readExpandStep(api, { ...STEP, idea: "slug-only" });
    expect(api).toHaveBeenCalledExactlyOnceWith(PR_VIEW_ARGS);
    expect(parseIssueComments).not.toHaveBeenCalled();
    expect(expandStepCheck).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ idea: "slug-only", comments: [] }),
    );
  });

  it("is missing, naming the PR, when the expand PR's output cannot be read, and runs no check", async () => {
    const api = vi.fn<Api>().mockResolvedValueOnce("not json");
    vi.mocked(parseExpandPr).mockReturnValue(undefined);
    await expect(readExpandStep(api, STEP)).resolves.toEqual({
      result: "missing",
      detail: "gh returned unreadable output for expand step #547",
    });
    expect(api).toHaveBeenCalledExactlyOnceWith(PR_VIEW_ARGS);
    expect(expandStepCheck).not.toHaveBeenCalled();
  });

  it("is missing, naming the idea, when the idea's comments cannot be read, and runs no check", async () => {
    const api = vi
      .fn<Api>()
      .mockResolvedValueOnce("merged-json")
      .mockResolvedValueOnce("not json");
    vi.mocked(parseExpandPr).mockReturnValue({ mergedAt: EXPAND_MERGED });
    vi.mocked(parseIssueComments).mockReturnValue(undefined);
    await expect(readExpandStep(api, STEP)).resolves.toEqual({
      result: "missing",
      detail: "gh returned unreadable comments for issue #502",
    });
    expect(expandStepCheck).not.toHaveBeenCalled();
  });
});

describe("readExpandStep hands what it read to the check and returns the check's result", () => {
  it("hands the merge time, head time, idea, comments and reviewers to the check", async () => {
    vi.mocked(parseExpandPr).mockReturnValue({ mergedAt: EXPAND_MERGED });
    vi.mocked(parseIssueComments).mockReturnValue(COMMENTS);
    vi.mocked(expandStepCheck).mockReturnValue({ result: "pass" });
    await readExpandStep(vi.fn<Api>().mockResolvedValue("x"), STEP);
    expect(expandStepCheck).toHaveBeenCalledExactlyOnceWith({
      pr: 584,
      expandPr: 547,
      mergedAt: EXPAND_MERGED,
      headCommittedAt: HEAD_COMMITTED,
      idea: "502",
      comments: COMMENTS,
      reviewers: [OWNER],
    });
  });

  it("returns the check's refusal as it is, adding no verdict of its own", async () => {
    vi.mocked(parseExpandPr).mockReturnValue({ mergedAt: undefined });
    vi.mocked(parseIssueComments).mockReturnValue([]);
    vi.mocked(expandStepCheck).mockReturnValue({
      result: "pending",
      detail: "expand step #547 is not merged",
    });
    await expect(
      readExpandStep(vi.fn<Api>().mockResolvedValue("x"), STEP),
    ).resolves.toEqual({
      result: "pending",
      detail: "expand step #547 is not merged",
    });
  });
});
