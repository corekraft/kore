import { describe, expect, it } from "vitest";
import { CLOSING_ITEM, closingAudit } from "./closing-audit.js";

// The closing-keyword item is pure over the PR body and the declared idea, so no collaborator is
// mocked: each test states the body it reads, and the findings it must, and must not, produce.
const IDEA = "0010";

describe("closingAudit names a closing keyword beside an Idea line, with its keyword, number and fix", () => {
  it("names a `Closes #n` in a body that also declares an idea", () => {
    expect(closingAudit("Closes #54\nIdea: 0010", IDEA)).toEqual([
      {
        item: CLOSING_ITEM,
        file: "PR body",
        detail: "Closes #54",
        fix: "replace it with Refs #54 (ADR 0097)",
      },
    ]);
  });

  it("names each of GitHub's closing keywords, in any case", () => {
    const body = [
      "close #1",
      "closes #2",
      "closed #3",
      "fix #4",
      "fixes #5",
      "fixed #6",
      "resolve #7",
      "resolves #8",
      "RESOLVED #9",
    ].join("\n");
    expect(closingAudit(body, IDEA).map((f) => f.detail)).toEqual([
      "close #1",
      "closes #2",
      "closed #3",
      "fix #4",
      "fixes #5",
      "fixed #6",
      "resolve #7",
      "resolves #8",
      "RESOLVED #9",
    ]);
  });

  it("names a cross-repository `owner/repo#n` reference, with that reference in the fix", () => {
    expect(closingAudit("Fixes corekraft/kore#54\nIdea: 0010", IDEA)).toEqual([
      {
        item: CLOSING_ITEM,
        file: "PR body",
        detail: "Fixes corekraft/kore#54",
        fix: "replace it with Refs corekraft/kore#54 (ADR 0097)",
      },
    ]);
  });

  it("names each closing reference in the order the body writes them", () => {
    expect(
      closingAudit("Closes #2\nFixes #9\nIdea: 0010", IDEA).map((f) => [
        f.detail,
      ]),
    ).toEqual([["Closes #2"], ["Fixes #9"]]);
  });
});

describe("closingAudit does not flag a reference that GitHub would not close, or a body with no idea", () => {
  it("produces no finding for `Refs #n` beside an idea", () => {
    expect(closingAudit("Refs #54\nIdea: 0010", IDEA)).toEqual([]);
  });

  it("produces no finding for a closing keyword in a body that declares no idea", () => {
    expect(closingAudit("Closes #54", undefined)).toEqual([]);
  });

  it("produces no finding for a keyword in prose with no issue number after it", () => {
    expect(
      closingAudit("This closes the gap in the writer tier.\nIdea: 0010", IDEA),
    ).toEqual([]);
  });

  it("produces no finding for a keyword inside an HTML comment, which is template guidance", () => {
    expect(
      closingAudit("<!-- Closes #54 is wrong; use Refs -->\nIdea: 0010", IDEA),
    ).toEqual([]);
  });

  it("produces no finding for a word that only contains a keyword", () => {
    expect(
      closingAudit("Enclosed #54 and prefixes #9\nIdea: 0010", IDEA),
    ).toEqual([]);
  });
});
