import { describe, expect, it } from "vitest";
import { sendBackReason, type PrecheckReport } from "./precheck-reason.js";

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

describe("sendBackReason", () => {
  it("sends nothing back when the precheck passes", () => {
    expect(sendBackReason(report())).toBeUndefined();
  });

  it("names the declaration's reason when no valid pattern is declared", () => {
    expect(
      sendBackReason(
        report({
          ok: false,
          declaration: { ok: false, reason: "No `Safety pattern:` line." },
        }),
      ),
    ).toBe("The precheck failed: No `Safety pattern:` line.");
  });

  it("names every check that failed, with its detail", () => {
    const reason = sendBackReason(
      report({
        ok: false,
        checks: {
          ci: { result: "fail", detail: "unit" },
          scan: PASS,
          coverage: { result: "fail" },
          principlesReview: PASS,
        },
      }),
    );
    expect(reason).toBe("The precheck failed: ci: fail (unit); coverage: fail");
  });

  it("names a pattern mismatch", () => {
    expect(
      sendBackReason(
        report({ ok: false, patternMismatch: "touches apps/ but declares X" }),
      ),
    ).toBe(
      "The precheck failed: pattern mismatch: touches apps/ but declares X",
    );
  });

  it("does not send back for a check still running or a review not yet posted, so the judge still launches", () => {
    expect(
      sendBackReason(
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

  it("sends back a principles-review that found something", () => {
    expect(
      sendBackReason(
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
    ).toBe("The precheck failed: principlesReview: fail (1 finding)");
  });
});
