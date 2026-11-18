import { describe, expect, it, vi } from "vitest";
import { RULE_LABEL_LENGTH, ruleLabels } from "./review-rules.js";

vi.mock("../ledger/index.js", () => ({
  MAX_RULE_LABELS: 10,
  RULE_LABEL_LENGTH: 32,
}));

describe("ruleLabels reads the cited rule from each finding, as a short label and nothing else", () => {
  it("takes the second field of `file:line | rule | what | fix` as a lowercase slug", () => {
    expect(
      ruleLabels([
        "a.ts:1 | Tests describe behavior | the test names a mock | rename it",
        "b.ts:2 | Errors are actionable | no fix named | add the fix",
      ]),
    ).toEqual(["tests-describe-behavior", "errors-are-actionable"]);
  });

  it("strips markdown emphasis and punctuation around the rule", () => {
    expect(ruleLabels(["a.ts:1 | **Pin everything.** | x | y"])).toEqual([
      "pin-everything",
    ]);
  });

  it("lists a rule once however many findings cite it", () => {
    expect(
      ruleLabels([
        "a:1 | Pin everything | x | y",
        "b:2 | pin everything | x | y",
      ]),
    ).toEqual(["pin-everything"]);
  });

  it("bounds a label to the fixed length, cutting at the length", () => {
    const [label] = ruleLabels([`a:1 | ${"word ".repeat(30)} | x | y`]);
    expect(label).toHaveLength(RULE_LABEL_LENGTH);
    expect(label).toBe("word-word-word-word-word-word-wo");
  });

  it("gives no label for a finding with no rule field, and never copies its text", () => {
    expect(ruleLabels(["this is free text with no separator"])).toEqual([]);
    expect(ruleLabels(["a.ts:1 |  | x | y"])).toEqual([]);
  });

  it("keeps at most ten labels", () => {
    const findings = Array.from(
      { length: 12 },
      (_, i) => `a:${i} | rule ${i} | x | y`,
    );
    expect(ruleLabels(findings)).toHaveLength(10);
  });

  it("gives no labels for a clean review", () => {
    expect(ruleLabels([])).toEqual([]);
  });
});
