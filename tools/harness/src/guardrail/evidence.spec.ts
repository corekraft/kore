// The request evidence unit: four summary figures for one guardrail, read from a
// retro-scan report. Pure; the report is plain data, so nothing is mocked.
// Docs: infra/plans/12-self-improving-loop.md#step-4-guardrail-activation-gate

import { describe, expect, it } from "vitest";
import { classifyAudit, requestEvidence } from "./evidence.js";
import { GuardrailError } from "./inventory.js";

const audit = (rule: string, warnings: number, heeded: number) => ({
  rule,
  status: "x",
  warnings,
  heeded,
  overridden: warnings - heeded,
  repeated: 0,
  unresolved: 0,
  sessions: 2,
});

describe("classifyAudit", () => {
  it("is insufficient-evidence below five warnings, even when all were heeded", () => {
    expect(classifyAudit(4, 4)).toBe("insufficient-evidence");
  });

  it("is promotable when at least five warnings were all heeded", () => {
    expect(classifyAudit(5, 5)).toBe("promotable");
  });

  it("is not-promotable when any of five warnings was not heeded", () => {
    expect(classifyAudit(6, 5)).toBe("not-promotable");
  });
});

describe("requestEvidence from an audit rule (tightening)", () => {
  const report = { rules: { audit: [audit("bare-glob", 6, 5)] } };

  it("reports fired, heeded, overridden and the stated false positives", () => {
    expect(requestEvidence(report, "bare-glob", "audit", 1)).toEqual({
      fired: 6,
      heeded: 5,
      overridden: 1,
      falsePositives: 1,
      classification: "not-promotable",
    });
  });

  it("classifies from the counts, whatever status string the report carries", () => {
    const evidence = requestEvidence(
      { rules: { audit: [audit("r", 5, 5)] } },
      "r",
      "audit",
      0,
    );
    expect(evidence.classification).toBe("promotable");
  });

  it("refuses a report with no row for the rule, naming how to scan it", () => {
    expect(() => requestEvidence(report, "other", "audit", 0)).toThrow(
      new GuardrailError(
        'The scan report has no audit row for "other", so there is no evidence to present. Run `harness hook retro-scan --strict` with the rule in audit mode, then pass its output with --scan.',
      ),
    );
  });
});

describe("requestEvidence from an enforce rule (loosening)", () => {
  it("counts its blocks as fired and leaves heeded and overridden unmeasured", () => {
    const report = { guards: { "no-verify": { blocks: 3, warnings: 0 } } };
    expect(requestEvidence(report, "no-verify", "enforce", 2)).toEqual({
      fired: 3,
      heeded: null,
      overridden: null,
      falsePositives: 2,
      classification: null,
    });
  });

  it("reports zero fired for a rule the scan saw no block of", () => {
    expect(
      requestEvidence({ guards: {} }, "no-verify", "enforce", 0).fired,
    ).toBe(0);
  });
});

describe("requestEvidence on a bad report", () => {
  it("refuses something that is not a retro-scan report", () => {
    expect(() => requestEvidence("nope", "r", "audit", 0)).toThrow(
      "The scan report is not a retro-scan report (no rules.audit or guards). Pass the JSON `harness hook retro-scan --strict` printed.",
    );
  });
});
