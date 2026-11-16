import { describe, expect, it } from "vitest";
import { sendBackFor, type PrecheckReport } from "./precheck-reason.js";

const PASS = { result: "pass" } as const;
const report = (over: Partial<PrecheckReport> = {}): PrecheckReport => ({
  pr: 7,
  ok: true,
  declaration: { ok: true },
  checks: {
    ci: PASS,
    scan: PASS,
    coverage: PASS,
    principlesReview: PASS,
  },
  ...over,
});

describe("sendBackFor: the reason and its category", () => {
  it("sends nothing back when the precheck passes", () => {
    expect(sendBackFor(report())).toBeUndefined();
  });

  it("categorises a missing or invalid declaration as declaration", () => {
    expect(
      sendBackFor(
        report({
          ok: false,
          declaration: { ok: false, reason: "No `Safety pattern:` line." },
        }),
      ),
    ).toEqual({
      reason: "The precheck failed: No `Safety pattern:` line.",
      category: "declaration",
    });
  });

  it("categorises a failed check as failed-check, and names every one with its detail", () => {
    expect(
      sendBackFor(
        report({
          ok: false,
          checks: {
            ci: { result: "fail", detail: "unit" },
            scan: PASS,
            coverage: { result: "fail" },
            principlesReview: PASS,
          },
        }),
      ),
    ).toEqual({
      reason: "The precheck failed: ci: fail (unit); coverage: fail",
      category: "failed-check",
    });
  });

  it("categorises a principles-review that found something as failed-check", () => {
    expect(
      sendBackFor(
        report({
          ok: false,
          checks: {
            ci: PASS,
            scan: PASS,
            coverage: PASS,
            principlesReview: { result: "fail", detail: "1 finding" },
          },
        }),
      ),
    ).toEqual({
      reason: "The precheck failed: principlesReview: fail (1 finding)",
      category: "failed-check",
    });
  });
});

describe("sendBackFor: each failure's category", () => {
  it("categorises a failed expand-step check as missing-proof", () => {
    expect(
      sendBackFor(
        report({
          ok: false,
          checks: {
            ci: PASS,
            scan: PASS,
            coverage: PASS,
            principlesReview: PASS,
            expandStep: { result: "fail", detail: "merged after the head" },
          },
        }),
      ),
    ).toEqual({
      reason: "The precheck failed: expandStep: fail (merged after the head)",
      category: "missing-proof",
    });
  });

  it("categorises a pattern mismatch as pattern-mismatch", () => {
    expect(
      sendBackFor(
        report({ ok: false, patternMismatch: "touches apps/ but declares X" }),
      ),
    ).toEqual({
      reason:
        "The precheck failed: pattern mismatch: touches apps/ but declares X",
      category: "pattern-mismatch",
    });
  });

  it("takes the category of the first failure its reason names, so one category is sent", () => {
    expect(
      sendBackFor(
        report({
          ok: false,
          checks: {
            ci: { result: "fail" },
            scan: PASS,
            coverage: PASS,
            principlesReview: PASS,
          },
          patternMismatch: "touches apps/ but declares X",
        }),
      ),
    ).toEqual({
      reason:
        "The precheck failed: ci: fail; pattern mismatch: touches apps/ but declares X",
      category: "failed-check",
    });
  });

  it("does not send back for a check still running or a review not yet posted, so the judge still launches", () => {
    expect(
      sendBackFor(
        report({
          ok: false,
          checks: {
            ci: { result: "pending" },
            scan: PASS,
            coverage: { result: "missing" },
            principlesReview: { result: "missing" },
          },
        }),
      ),
    ).toBeUndefined();
  });
});
