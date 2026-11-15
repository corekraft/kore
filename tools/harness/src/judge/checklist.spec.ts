// The checklist unit: which items fail the judge's verdict, by the mode each reads
// from the inventory. The inventory is mocked; only types and constants are real.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { modeOf, type Inventory } from "../guardrail/index.js";
import {
  ENFORCE_ALL,
  ITEMS,
  evaluateChecklist,
  modesFrom,
  ruleOf,
  type Findings,
} from "./checklist.js";
import { JudgeError } from "./errors.js";

vi.mock("../guardrail/index.js");

const PASSING: Findings = {
  ci: { result: "pass" },
  scan: { result: "pass" },
  coverage: { result: "pass" },
  "principles-review": { result: "pass" },
  "pattern-match": { result: "pass" },
};

beforeEach(() => {
  vi.mocked(modeOf).mockReset();
});

describe("evaluateChecklist", () => {
  it("sends the change back when an enforce item fails", () => {
    const out = evaluateChecklist(
      { ...PASSING, scan: { result: "fail", detail: "scan: failure" } },
      ENFORCE_ALL,
    );
    expect(out.ok).toBe(false);
    expect(out.audited).toEqual([]);
  });

  it("never sends the change back for an audit item that fails, and reports it", () => {
    const out = evaluateChecklist(
      { ...PASSING, scan: { result: "fail", detail: "scan: failure" } },
      { ...ENFORCE_ALL, scan: "audit" },
    );
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

  it("counts a missing, pending or unverified audit item as a failure to report, not a send-back", () => {
    const out = evaluateChecklist(
      {
        ...PASSING,
        ci: { result: "pending" },
        coverage: { result: "missing" },
        "principles-review": { result: "unverified" },
      },
      {
        ci: "audit",
        scan: "enforce",
        coverage: "audit",
        "principles-review": "audit",
        "expand-step": "enforce",
        "pattern-match": "enforce",
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
      { ...PASSING, scan: { result: "fail" }, ci: { result: "fail" } },
      { ...ENFORCE_ALL, scan: "audit" },
    );
    expect(out.ok).toBe(false);
    expect(out.audited.map((a) => a.item)).toEqual(["scan"]);
  });

  it("reports no audit firing for an audit item that passes", () => {
    const out = evaluateChecklist(PASSING, { ...ENFORCE_ALL, ci: "audit" });
    expect(out.audited).toEqual([]);
    expect(out.items.find((i) => i.item === "ci")).toEqual({
      item: "ci",
      rule: "judge-ci",
      mode: "audit",
      result: "pass",
    });
  });

  it("skips an item that was not gathered, such as the expand step of a diff that needs none", () => {
    const out = evaluateChecklist(PASSING, ENFORCE_ALL);
    expect(out.items.map((i) => i.item)).not.toContain("expand-step");
    expect(out.ok).toBe(true);
  });

  it("judges a gathered expand step by its own mode", () => {
    const failing = { ...PASSING, "expand-step": { result: "fail" as const } };
    expect(evaluateChecklist(failing, ENFORCE_ALL).ok).toBe(false);
    expect(
      evaluateChecklist(failing, { ...ENFORCE_ALL, "expand-step": "audit" }).ok,
    ).toBe(true);
  });
});

describe("modes today", () => {
  it("keep every existing item in enforce", () => {
    expect(ITEMS.map((i) => ENFORCE_ALL[i])).toEqual(
      ITEMS.map(() => "enforce"),
    );
  });

  it("name each item's rule in the inventory with a judge- prefix", () => {
    expect(ITEMS.map(ruleOf)).toEqual([
      "judge-ci",
      "judge-scan",
      "judge-coverage",
      "judge-principles-review",
      "judge-expand-step",
      "judge-pattern-match",
    ]);
  });
});

describe("modesFrom", () => {
  const inventory = { guardrails: [] } as Inventory;

  it("reads each item's mode from the inventory by its rule name", () => {
    vi.mocked(modeOf).mockImplementation((_i, rule) =>
      rule === "judge-scan" ? "audit" : "enforce",
    );
    expect(modesFrom(inventory)).toEqual({ ...ENFORCE_ALL, scan: "audit" });
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
