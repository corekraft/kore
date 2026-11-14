import { describe, expect, it, vi } from "vitest";
import {
  type ExpandComment,
  expandStepCheck,
  parseExpandPr,
  parseIssueComments,
  readExpandStep,
  type ExpandFacts,
} from "./expand-step.js";
import type { Api } from "./manifest-source.js";

const OWNER = "junners";
const EXPAND_MERGED = "2026-11-14T15:19:20Z";
const HEAD_COMMITTED = "2026-11-14T16:00:00Z";
const PROOF = "Expand proof: #547 the warning ran clean on main";

const comment = (author: string, body: string): ExpandComment => ({
  author,
  body,
  createdAt: "2026-11-14T17:36:41Z",
});

/** The facts of contract PR #584 whose expand step is #547, merged before its head. */
function facts(over: Partial<ExpandFacts> = {}): ExpandFacts {
  return {
    pr: 584,
    expandPr: 547,
    mergedAt: EXPAND_MERGED,
    headCommittedAt: HEAD_COMMITTED,
    idea: "502",
    comments: [comment(OWNER, PROOF)],
    reviewers: [OWNER],
    ...over,
  };
}

describe("expandStepCheck passes a contract only when its expand step is proven", () => {
  it("passes when the expand PR merged before the head and a reviewer recorded its proof", () => {
    expect(expandStepCheck(facts())).toEqual({ result: "pass" });
  });

  it("is pending while the expand PR is not merged, and says to merge it", () => {
    expect(expandStepCheck(facts({ mergedAt: undefined }))).toEqual({
      result: "pending",
      detail:
        "expand step #547 is not merged; merge it, then rerun `harness judge precheck 584`",
    });
  });

  it("fails when the expand PR merged after the head commit, and says to push a commit", () => {
    expect(
      expandStepCheck(facts({ mergedAt: "2026-11-14T16:30:00Z" })),
    ).toEqual({
      result: "fail",
      detail:
        "expand step #547 merged at 2026-11-14T16:30:00Z, not before this PR's head commit at 2026-11-14T16:00:00Z; push a commit to this PR after the expand step merged, then rerun `harness judge precheck 584`",
    });
  });

  it("fails when the expand PR merged at the same instant as the head commit", () => {
    expect(expandStepCheck(facts({ mergedAt: HEAD_COMMITTED })).result).toBe(
      "fail",
    );
  });

  it("is missing when the PR has no commit to order the expand step against", () => {
    expect(expandStepCheck(facts({ headCommittedAt: undefined }))).toEqual({
      result: "missing",
      detail:
        "this PR has no commit to order the expand step against; rerun `harness judge precheck 584`",
    });
  });

  it("is missing when the idea names no issue, because the proof lives on that issue", () => {
    expect(expandStepCheck(facts({ idea: "slug-only" }))).toEqual({
      result: "missing",
      detail:
        'the Idea line names "slug-only", not an issue number; name the issue that records the expand proof (Idea: <issue number>)',
    });
    expect(expandStepCheck(facts({ idea: undefined })).detail).toBe(
      "the PR has no Idea line; name the issue that records the expand proof (Idea: <issue number>)",
    );
  });
});

describe("expandStepCheck refuses a contract whose expand step is not proven by a reviewer", () => {
  it("is missing when no reviewer recorded the proof for this expand PR", () => {
    expect(expandStepCheck(facts({ comments: [] }))).toEqual({
      result: "missing",
      detail:
        'no "Expand proof: #547" comment from junners on issue #502; the owner records it there once the expand outcome is recorded, then rerun `harness judge precheck 584`',
    });
  });

  it("is missing when the proof comes from a login that is not a recognised reviewer", () => {
    expect(
      expandStepCheck(facts({ comments: [comment("drive-by", PROOF)] })).result,
    ).toBe("missing");
  });

  it("is missing when the proof names another expand PR, so a proof cannot be reused", () => {
    expect(
      expandStepCheck(
        facts({
          comments: [comment(OWNER, "Expand proof: #5470 another step")],
        }),
      ).result,
    ).toBe("missing");
  });

  it("reads the proof from any line of a reviewer's comment, and only from a line that starts with it", () => {
    expect(
      expandStepCheck(
        facts({
          comments: [comment(OWNER, `Outcome recorded.\n${PROOF}\nthanks`)],
        }),
      ).result,
    ).toBe("pass");
    expect(
      expandStepCheck(facts({ comments: [comment(OWNER, `see ${PROOF}`)] }))
        .result,
    ).toBe("missing");
  });
});

describe("readExpandStep reads the expand PR and the idea's comments through gh", () => {
  const STEP = {
    pr: 584,
    expandPr: 547,
    idea: "502",
    headCommittedAt: HEAD_COMMITTED,
    reviewers: [OWNER],
  };
  const PR_VIEW_ARGS = ["pr", "view", "547", "--json", "mergedAt"];
  const ISSUE_ARGS = ["issue", "view", "502", "--json", "comments"];
  const merged = JSON.stringify({ mergedAt: EXPAND_MERGED });
  const issue = JSON.stringify({
    comments: [{ author: { login: OWNER }, body: PROOF, createdAt: "x" }],
  });

  it("reads the expand PR's merge time and the idea issue's comments, and passes", async () => {
    const api = vi.fn<Api>();
    api.mockResolvedValueOnce(merged).mockResolvedValueOnce(issue);
    await expect(readExpandStep(api, STEP)).resolves.toEqual({
      result: "pass",
    });
    expect(api).toHaveBeenNthCalledWith(1, PR_VIEW_ARGS);
    expect(api).toHaveBeenNthCalledWith(2, ISSUE_ARGS);
  });

  it("does not read the idea issue when the idea is not an issue number", async () => {
    const api = vi.fn<Api>().mockResolvedValueOnce(merged);
    await expect(
      readExpandStep(api, { ...STEP, idea: "slug-only" }),
    ).resolves.toMatchObject({ result: "missing" });
    expect(api).toHaveBeenCalledExactlyOnceWith(PR_VIEW_ARGS);
  });

  it("is missing, naming the PR, when the expand PR's output cannot be read", async () => {
    const api = vi.fn<Api>().mockResolvedValueOnce("not json");
    await expect(readExpandStep(api, STEP)).resolves.toEqual({
      result: "missing",
      detail: "gh returned unreadable output for expand step #547",
    });
  });

  it("is missing, naming the idea, when the idea's comments cannot be read", async () => {
    const api = vi
      .fn<Api>()
      .mockResolvedValueOnce(merged)
      .mockResolvedValueOnce("not json");
    await expect(readExpandStep(api, STEP)).resolves.toEqual({
      result: "missing",
      detail: "gh returned unreadable comments for issue #502",
    });
  });
});

describe("parseExpandPr reads the merge time of an expand PR", () => {
  it("reads the merge time, and undefined for a PR not merged", () => {
    expect(parseExpandPr(merged())).toEqual({ mergedAt: EXPAND_MERGED });
    expect(parseExpandPr(JSON.stringify({ mergedAt: null }))).toEqual({
      mergedAt: undefined,
    });
  });

  it("returns undefined for output that is not JSON", () => {
    expect(parseExpandPr("nope")).toBeUndefined();
  });

  function merged(): string {
    return JSON.stringify({ mergedAt: EXPAND_MERGED });
  }
});

describe("parseIssueComments reads an issue's comments", () => {
  it("maps each comment's author login, body and creation time", () => {
    expect(
      parseIssueComments(
        JSON.stringify({
          comments: [
            { author: { login: OWNER }, body: PROOF, createdAt: "t1" },
          ],
        }),
      ),
    ).toEqual([{ author: OWNER, body: PROOF, createdAt: "t1" }]);
  });

  it("returns undefined for output that is not JSON", () => {
    expect(parseIssueComments("nope")).toBeUndefined();
  });
});
