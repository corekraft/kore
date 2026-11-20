import { describe, expect, it } from "vitest";
import { readVerdict } from "./review-verdict-read.js";

describe("readVerdict reads the Reviewer's verdict from its pane text", () => {
  it("reads a clean review as no findings", () => {
    expect(readVerdict("looked at it\nVERDICT: none\nRESULT: done\n")).toEqual(
      [],
    );
  });

  it("reads each line between the findings marker and the end marker as one finding", () => {
    const pane = [
      "VERDICT: findings",
      "a.ts:1 | one rule | wrong | fix",
      "  b.ts:2 | another | wrong | fix  ",
      "",
      "END VERDICT",
      "RESULT: done",
    ].join("\n");
    expect(readVerdict(pane)).toEqual([
      "a.ts:1 | one rule | wrong | fix",
      "b.ts:2 | another | wrong | fix",
    ]);
  });

  it("accepts Claude's bullet and indent in front of a marker line", () => {
    expect(readVerdict("● VERDICT: none")).toEqual([]);
    expect(readVerdict("  VERDICT: findings\nx\n  END VERDICT")).toEqual(["x"]);
  });

  it("reads the last verdict when the pane holds more than one", () => {
    expect(
      readVerdict("VERDICT: findings\nold\nEND VERDICT\nVERDICT: none"),
    ).toEqual([]);
  });

  it("reads a findings block whose rows a narrow pane wrapped as the same findings as unwrapped rows", () => {
    const wrapped = [
      "VERDICT: findings",
      "tools/harness/src/judge/checks.ts:1 | one rule | the cut word is describeU",
      "pdateFailure in the block | fix it",
      "tools/harness/wizar",
      "ds/identities.sh:9 | another | wrong | fix",
      "END VERDICT",
    ].join("\n");
    const unwrapped = [
      "VERDICT: findings",
      "tools/harness/src/judge/checks.ts:1 | one rule | the cut word is describeUpdateFailure in the block | fix it",
      "tools/harness/wizards/identities.sh:9 | another | wrong | fix",
      "END VERDICT",
    ].join("\n");
    expect(readVerdict(wrapped)).toEqual(readVerdict(unwrapped));
    expect(readVerdict(wrapped)).toHaveLength(2);
  });

  it("reads a clean review whose prose a narrow pane wrapped around its marker", () => {
    expect(
      readVerdict(
        "I checked the change against the\nprinciples and found\n● VERDICT: none\nRESULT: done",
      ),
    ).toEqual([]);
  });

  it("reads nothing when no marker line shows, so a broken review never reads as a pass", () => {
    expect(readVerdict("No violations.\nRESULT: done")).toBeUndefined();
    expect(readVerdict("")).toBeUndefined();
  });

  it("does not take a marker quoted inside a longer line, such as the brief's own description", () => {
    expect(
      readVerdict('end with a line "VERDICT: none" or a findings block'),
    ).toBeUndefined();
  });

  it("reads nothing from a findings block with no end marker or no finding", () => {
    expect(readVerdict("VERDICT: findings\nx\ny")).toBeUndefined();
    expect(readVerdict("VERDICT: findings\n\nEND VERDICT")).toBeUndefined();
  });
});
