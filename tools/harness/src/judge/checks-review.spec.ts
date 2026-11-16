import { describe, expect, it } from "vitest";
import { reviewCheck } from "./checks.js";
import { HEAD, REVIEWERS, review, view } from "./checks-support.js";

describe("reviewCheck passes or fails a trusted verdict", () => {
  it("is missing, with the verdict to post, when no principles-review comment exists", () => {
    expect(
      reviewCheck(view({ comments: [review("looks good")] }), REVIEWERS),
    ).toEqual({
      result: "missing",
      detail:
        "no `principles-review:` comment; run the principles-review agent and post its verdict as `principles-review: No violations.` or `principles-review: <n> violations`",
    });
  });

  it("passes a clean verdict from a listed reviewer made after the head commit", () => {
    const comments = [review("principles-review: No violations.")];
    expect(reviewCheck(view({ comments }), REVIEWERS)).toEqual({
      result: "pass",
    });
  });

  it("fails a verdict that names violations, with the verdict as the detail", () => {
    const comments = [review("principles-review: 2 violations")];
    expect(reviewCheck(view({ comments }), REVIEWERS)).toEqual({
      result: "fail",
      detail: "2 violations",
    });
  });

  it("removes a trailing head clause before it compares the verdict", () => {
    const comments = [
      review("principles-review: No violations. (head abc1234)"),
    ];
    expect(reviewCheck(view({ comments }), REVIEWERS)).toEqual({
      result: "pass",
    });
  });

  it("the newest trusted verdict decides, whatever order the comments come in", () => {
    const comments = [
      review(
        "principles-review: No violations.",
        "reviewer-bot",
        "2026-11-14T12:00:00Z",
      ),
      review(
        "principles-review: 1 violation",
        "reviewer-bot",
        "2026-11-14T11:00:00Z",
      ),
    ];
    expect(reviewCheck(view({ comments }), REVIEWERS)).toEqual({
      result: "pass",
    });
  });
});

describe("reviewCheck reads the same verdict with a sender line first", () => {
  const SENDER = "sender: writer fix-x (review post)";

  it("passes a clean verdict behind a sender line, as it passes one without", () => {
    const comments = [review(`${SENDER}\nprinciples-review: No violations.`)];
    expect(reviewCheck(view({ comments }), REVIEWERS)).toEqual({
      result: "pass",
    });
  });

  it("fails a verdict behind a sender line with the same detail", () => {
    const comments = [review(`${SENDER}\nprinciples-review: 2 violations`)];
    expect(reviewCheck(view({ comments }), REVIEWERS)).toEqual({
      result: "fail",
      detail: "2 violations",
    });
  });

  it("does not take a sender line for a verdict of its own", () => {
    const comments = [review(`${SENDER}\nlooks good`)];
    expect(reviewCheck(view({ comments }), REVIEWERS).result).toBe("missing");
  });

  it("trusts a verdict behind a sender line that names the current head, as it trusts one without", () => {
    const comments = [
      review(
        `${SENDER}\nprinciples-review: No violations. head ${HEAD.slice(0, 7)}`,
        "reviewer-bot",
        "2026-11-14T09:00:00Z",
      ),
    ];
    expect(reviewCheck(view({ comments }), REVIEWERS)).toEqual({
      result: "pass",
    });
  });
});

describe("reviewCheck refuses a verdict it cannot trust", () => {
  it("does not trust a verdict from an author who is not a listed reviewer", () => {
    const comments = [review("principles-review: No violations.", "someone")];
    expect(reviewCheck(view({ comments }), REVIEWERS)).toEqual({
      result: "unverified",
      detail:
        'no principles-review comment from reviewer-bot for the current head (name it as "head <sha>", or post it after the head commit); rerun the review on the current head',
    });
  });

  it("does not trust a verdict posted before the head commit", () => {
    const comments = [
      review(
        "principles-review: No violations.",
        "reviewer-bot",
        "2026-11-14T09:00:00Z",
      ),
    ];
    expect(reviewCheck(view({ comments }), REVIEWERS).result).toBe(
      "unverified",
    );
  });

  it("trusts a verdict that names the current head, even when it predates the commit", () => {
    const comments = [
      review(
        `principles-review: No violations. head ${HEAD.slice(0, 7)}`,
        "reviewer-bot",
        "2026-11-14T09:00:00Z",
      ),
    ];
    expect(reviewCheck(view({ comments }), REVIEWERS)).toEqual({
      result: "pass",
    });
  });

  it("does not trust a verdict that names an older head, even when it is newer", () => {
    const comments = [review("principles-review: No violations. head 1111111")];
    expect(reviewCheck(view({ comments }), REVIEWERS).result).toBe(
      "unverified",
    );
  });
});

describe("reviewCheck trusts the Reviewer App's verdict once the config names it", () => {
  const APP = ["junners", "app/kore-reviewer"];

  it("passes a clean verdict posted by the Reviewer App's login after the head commit", () => {
    const comments = [
      review("principles-review: No violations.", "app/kore-reviewer"),
    ];
    expect(reviewCheck(view({ comments }), APP)).toEqual({ result: "pass" });
  });

  it("does not trust the same verdict from an App it does not name, nor from a look-alike login", () => {
    const comments = [
      review("principles-review: No violations.", "app/kore-writer"),
      review("principles-review: No violations.", "kore-reviewer"),
    ];
    expect(reviewCheck(view({ comments }), APP)).toEqual({
      result: "unverified",
      detail:
        'no principles-review comment from junners or app/kore-reviewer for the current head (name it as "head <sha>", or post it after the head commit); rerun the review on the current head',
    });
  });
});
