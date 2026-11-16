// A guardrail request presents the same verdict the retro scan reaches for the
// same transcripts: the real scan over the synthetic fixtures, then the real
// evidence unit over its report.
// Docs: infra/plans/12-self-improving-loop.md#step-4-guardrail-activation-gate

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { requestEvidence } from "../../src/guardrail/index.js";
import { scan } from "../../src/testing/index.js";

const fixtures = new URL("../fixtures/retro/", import.meta.url).pathname;
const sessions = ["alpha", "bravo", "charlie"].map((id) => ({
  id,
  text: readFileSync(`${fixtures}${id}.jsonl`, "utf8"),
}));
const options = {
  since: "2026-10-31",
  knownSkills: [],
  auditRules: ["image-digest", "sample-audit", "unquoted-glob"],
};

const report = scan(sessions, options);

describe("request evidence against the retro scan", () => {
  it.each(["unquoted-glob", "image-digest", "sample-audit"])(
    "classifies %s as the scan does, with the scan's own counts",
    (rule) => {
      const row = report.rules.audit.find((r) => r.rule === rule);
      expect(row).toBeDefined();
      expect(requestEvidence(report, rule, "audit", 0)).toEqual({
        fired: row?.warnings,
        heeded: row?.heeded,
        overridden: row?.overridden,
        falsePositives: 0,
        classification: row?.status,
      });
    },
  );

  it("covers the promotable, insufficient-evidence and not-promotable classes", () => {
    const seen = new Set(
      report.rules.audit.map(
        (r) => requestEvidence(report, r.rule, "audit", 0).classification,
      ),
    );
    expect(seen.has("promotable")).toBe(true);
    expect(seen.has("insufficient-evidence")).toBe(true);
  });

  it("counts an enforced rule's blocks from the scan's guard counts", () => {
    expect(requestEvidence(report, "kubectl-context", "enforce", 0).fired).toBe(
      report.guards["kubectl-context"]?.blocks,
    );
  });

  it("carries no transcript text: the evidence is four numbers and a class", () => {
    const evidence = requestEvidence(report, "unquoted-glob", "audit", 0);
    expect(Object.keys(evidence).sort()).toEqual([
      "classification",
      "falsePositives",
      "fired",
      "heeded",
      "overridden",
    ]);
  });
});
