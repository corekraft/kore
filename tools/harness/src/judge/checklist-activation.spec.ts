// The judge's guardrail-activation item: a change that lands a new or changed guardrail in
// enforce, loosens one or removes one is sent back unless `guardrail activate` recorded it.
// The inventory is mocked; only types and constants are real.
// Docs: infra/plans/12-self-improving-loop.md#step-4-guardrail-activation-gate
import { describe, expect, it, vi } from "vitest";
import {
  applyChecklist,
  evaluateChecklist,
  type Findings,
  type ItemModes,
} from "./checklist.js";
import type { Checks } from "./checks.js";
import type { Report } from "./precheck.js";

vi.mock("../guardrail/index.js");

const ENFORCE: ItemModes = {
  ci: "enforce",
  scan: "enforce",
  coverage: "enforce",
  "principles-review": "enforce",
  "expand-step": "enforce",
  "pattern-match": "enforce",
  "guardrail-activation": "enforce",
};
const CHECKS: Checks = {
  ci: { result: "pass" },
  scan: { result: "pass" },
  coverage: { result: "pass" },
  principlesReview: { result: "pass" },
};
const report = (guardrailChanges?: string[]): Report => ({
  pr: 42,
  ok: true,
  head: "abc1234",
  reviewers: [],
  pattern: "no-behaviour-change",
  idea: "#1",
  declaration: { ok: true },
  checks: CHECKS,
  patternMatches: true,
  ...(guardrailChanges === undefined ? {} : { guardrailChanges }),
});
const ITEM = (out: Report) =>
  out.checklist?.find((i) => i.item === "guardrail-activation");

describe("the guardrail-activation item", () => {
  it("is absent when the change does not touch the inventory", () => {
    const out = applyChecklist(report(), ENFORCE, new Set());
    expect(ITEM(out)).toBeUndefined();
    expect(out.ok).toBe(true);
  });

  it("passes a change to enforce that a guardrail.activated event recorded", () => {
    const out = applyChecklist(
      report(["bare-glob:audit>enforce"]),
      ENFORCE,
      new Set(["bare-glob:audit>enforce"]),
    );
    expect(ITEM(out)).toEqual({
      item: "guardrail-activation",
      rule: "judge-guardrail-activation",
      mode: "enforce",
      result: "pass",
    });
    expect(out.ok).toBe(true);
  });

  it("sends back a changed guardrail that landed in enforce with no activation on record", () => {
    const out = applyChecklist(
      report(["bare-glob:audit>enforce"]),
      ENFORCE,
      new Set(),
    );
    expect(out.ok).toBe(false);
    expect(ITEM(out)).toMatchObject({
      result: "fail",
      detail:
        "bare-glob:audit>enforce has no guardrail.activated event; run `harness guardrail request` and `harness guardrail activate`, or land it in audit",
    });
  });

  it("sends back a new guardrail that lands in enforce, whatever was activated", () => {
    const out = applyChecklist(
      report(["fresh:new>enforce"]),
      ENFORCE,
      new Set(["fresh:audit>enforce"]),
    );
    expect(out.ok).toBe(false);
    expect(ITEM(out)?.detail).toContain("fresh:new>enforce");
  });

  it("sends back a loosening or a removal that no approval recorded, naming each", () => {
    const out = applyChecklist(
      report(["a:enforce>audit", "b:enforce>removed"]),
      ENFORCE,
      new Set(["a:enforce>audit"]),
    );
    expect(out.ok).toBe(false);
    expect(ITEM(out)?.detail).toContain("b:enforce>removed");
    expect(ITEM(out)?.detail).not.toContain("a:enforce>audit");
  });
});

describe("the guardrail-activation item by mode", () => {
  it("only reports it, never sends the change back, while its mode is audit", () => {
    const out = applyChecklist(
      report(["bare-glob:audit>enforce"]),
      { ...ENFORCE, "guardrail-activation": "audit" },
      new Set(),
    );
    expect(out.ok).toBe(true);
    expect(out.audited?.map((i) => i.item)).toEqual(["guardrail-activation"]);
  });

  it("is judged by evaluateChecklist like any gathered item", () => {
    const found: Findings = {
      ci: { result: "pass" },
      scan: { result: "pass" },
      coverage: { result: "pass" },
      "principles-review": { result: "pass" },
      "pattern-match": { result: "pass" },
      "guardrail-activation": { result: "fail" },
    };
    expect(evaluateChecklist(found, ENFORCE).ok).toBe(false);
  });
});
