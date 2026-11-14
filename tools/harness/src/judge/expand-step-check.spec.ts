import { describe, expect, it } from "vitest";
import {
  type ExpandComment,
  type ExpandFacts,
  expandStepCheck,
} from "./expand-step-check.js";

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
