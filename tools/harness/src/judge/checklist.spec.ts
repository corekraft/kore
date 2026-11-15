// The checklist unit: which items fail the judge's verdict, by the mode each reads
// from the inventory. The inventory is mocked; only types and constants are real.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { modeOf, type Inventory } from "../guardrail/index.js";
import {
  ITEMS,
  applyChecklist,
  evaluateChecklist,
  modesFrom,
  ruleOf,
  type Findings,
  type ItemModes,
} from "./checklist.js";
import type { Checks } from "./checks.js";
import { JudgeError } from "./errors.js";
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
const PASSING: Findings = {
  ci: { result: "pass" },
  scan: { result: "pass" },
  coverage: { result: "pass" },
  "principles-review": { result: "pass" },
  "pattern-match": { result: "pass" },
};
const SCAN_FAILS: Findings = {
  ...PASSING,
  scan: { result: "fail", detail: "scan: failure" },
};
const SCAN_AUDIT: ItemModes = { ...ENFORCE, scan: "audit" };

beforeEach(() => {
  vi.mocked(modeOf).mockReset();
});

describe("evaluateChecklist sends a change back only for an enforce item", () => {
  it("sends the change back when an enforce item fails", () => {
    const out = evaluateChecklist(SCAN_FAILS, ENFORCE);
    expect(out.ok).toBe(false);
    expect(out.audited).toEqual([]);
  });

  it("never sends the change back for an audit item that fails, and reports it", () => {
    const out = evaluateChecklist(SCAN_FAILS, SCAN_AUDIT);
    expect(out.ok).toBe(true);
    expect(out.audited).toEqual([
      {
        item: "scan",
        rule: "judge-scan",
        mode: "audit",
        result: "fail",
        detail: "scan: failure",
      },
    ]);
  });

  it("counts a missing, pending or unverified audit item as a firing, not a send-back", () => {
    const out = evaluateChecklist(
      {
        ...PASSING,
        ci: { result: "pending" },
        coverage: { result: "missing" },
        "principles-review": { result: "unverified" },
      },
      {
        ...ENFORCE,
        ci: "audit",
        coverage: "audit",
        "principles-review": "audit",
      },
    );
    expect(out.ok).toBe(true);
    expect(out.audited.map((a) => a.item)).toEqual([
      "ci",
      "coverage",
      "principles-review",
    ]);
  });

  it("still sends the change back when an enforce item fails beside a failing audit item", () => {
    const out = evaluateChecklist(
      { ...SCAN_FAILS, ci: { result: "fail" } },
      SCAN_AUDIT,
    );
    expect(out.ok).toBe(false);
    expect(out.audited.map((a) => a.item)).toEqual(["scan"]);
  });

  it("reports no audit firing for an audit item that passes", () => {
    const out = evaluateChecklist(PASSING, SCAN_AUDIT);
    expect(out.audited).toEqual([]);
    expect(out.items.find((i) => i.item === "scan")).toEqual({
      item: "scan",
      rule: "judge-scan",
      mode: "audit",
      result: "pass",
    });
  });
});

describe("evaluateChecklist and the expand step", () => {
  it("skips an item that was not gathered, such as the expand step of a diff that needs none", () => {
    const out = evaluateChecklist(PASSING, ENFORCE);
    expect(out.items.map((i) => i.item)).not.toContain("expand-step");
    expect(out.ok).toBe(true);
  });

  it("judges a gathered expand step by its own mode", () => {
    const failing = { ...PASSING, "expand-step": { result: "fail" as const } };
    expect(evaluateChecklist(failing, ENFORCE).ok).toBe(false);
    expect(
      evaluateChecklist(failing, { ...ENFORCE, "expand-step": "audit" }).ok,
    ).toBe(true);
  });
});

describe("applyChecklist", () => {
  const CHECKS: Checks = {
    ci: { result: "pass" },
    scan: { result: "fail", detail: "scan: failure" },
    coverage: { result: "pass" },
    principlesReview: { result: "pass" },
  };
  const report = (over: Partial<Report> = {}): Report => ({
    pr: 42,
    ok: false,
    head: "abc1234",
    reviewers: [],
    pattern: "no-behaviour-change",
    idea: "#1",
    declaration: { ok: true },
    checks: CHECKS,
    patternMatches: true,
    ...over,
  });

  it("keeps the change not ready when an enforce item fails, and lists every item", () => {
    const out = applyChecklist(report(), ENFORCE);
    expect(out.ok).toBe(false);
    expect(out.audited).toEqual([]);
    expect(out.checklist?.map((i) => i.item)).toEqual([
      "ci",
      "scan",
      "coverage",
      "principles-review",
      "pattern-match",
    ]);
  });

  it("makes the report ready, and names the audit item, when only an audit item fails", () => {
    const out = applyChecklist(report(), SCAN_AUDIT);
    expect(out.ok).toBe(true);
    expect(out.audited).toEqual([
      expect.objectContaining({ item: "scan", detail: "scan: failure" }),
    ]);
  });

  it("fails the pattern-match item with the mismatch as its detail", () => {
    const out = applyChecklist(
      report({
        checks: { ...CHECKS, scan: { result: "pass" } },
        patternMatches: false,
        patternMismatch: "no flag",
      }),
      ENFORCE,
    );
    expect(out.ok).toBe(false);
    expect(
      out.checklist?.find((i) => i.item === "pattern-match"),
    ).toMatchObject({ result: "fail", detail: "no flag" });
  });

  it("gives a gathered expand step its own item", () => {
    const out = applyChecklist(
      report({ checks: { ...CHECKS, expandStep: { result: "missing" } } }),
      { ...SCAN_AUDIT, "expand-step": "audit" },
    );
    expect(out.audited?.map((i) => i.item)).toEqual(["scan", "expand-step"]);
  });

  it("returns a report that stopped at its declaration as it is", () => {
    const { checks: _checks, ...rest } = report();
    const stopped: Report = { ...rest, declaration: { ok: false } };
    expect(applyChecklist(stopped, SCAN_AUDIT)).toBe(stopped);
  });
});

describe("modes today", () => {
  it("name each item's rule in the inventory with a judge- prefix", () => {
    expect(ITEMS.map(ruleOf)).toEqual([
      "judge-ci",
      "judge-scan",
      "judge-coverage",
      "judge-principles-review",
      "judge-expand-step",
      "judge-pattern-match",
      "judge-guardrail-activation",
    ]);
  });
});

describe("modesFrom", () => {
  const inventory = { guardrails: [] } as Inventory;

  it("reads each item's mode from the inventory by its rule name", () => {
    vi.mocked(modeOf).mockImplementation((_i, rule) =>
      rule === "judge-scan" ? "audit" : "enforce",
    );
    expect(modesFrom(inventory)).toEqual(SCAN_AUDIT);
    expect(modeOf).toHaveBeenCalledWith(inventory, "judge-ci");
  });

  it("refuses a mode that is neither audit nor enforce, naming the rule and the fix, and never falls back to enforce", () => {
    vi.mocked(modeOf).mockImplementation(
      (_i, rule) => (rule === "judge-scan" ? "warn" : "enforce") as "audit",
    );
    expect(() => modesFrom(inventory)).toThrow(
      new JudgeError(
        'judge-scan has the mode "warn" in .claude/guardrails.yaml. Set it to audit or enforce, then rerun.',
      ),
    );
  });
});
