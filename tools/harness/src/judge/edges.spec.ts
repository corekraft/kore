import { describe, expect, it } from "vitest";
import { parsePrView } from "./checks.js";
import { parseDeclaration } from "./declaration.js";
import { parseDiff } from "./diff.js";
import { hintsFor } from "./hints.js";

const overlay = (...lines: string[]) =>
  [
    "diff --git a/infra/environments/local/environment.yaml b/infra/environments/local/environment.yaml",
    "--- a/infra/environments/local/environment.yaml",
    "+++ b/infra/environments/local/environment.yaml",
    "@@ -1,4 +1,4 @@",
    ...lines,
  ].join("\n");

describe("parsePrView", () => {
  it("refuses output that is not JSON", () => {
    expect(parsePrView("not json")).toBeUndefined();
  });

  it("tolerates a PR with no comments, commits or checks", () => {
    expect(parsePrView("{}")).toEqual({
      baseSha: "",
      body: "",
      comments: [],
      headCommittedAt: undefined,
      headSha: "",
      rollup: [],
    });
  });

  it("reads the base commit the PR was opened against", () => {
    expect(parsePrView('{"baseRefOid":"abc123"}')?.baseSha).toBe("abc123");
  });

  it("reads a comment with no author as an empty author", () => {
    expect(
      parsePrView(
        '{"comments":[{"body":"x","createdAt":"2026-01-01T00:00:00Z"}]}',
      )?.comments[0]?.author,
    ).toBe("");
  });
});

describe("declaration and hint edges", () => {
  it("reads a backticked pattern and a blank idea as none", () => {
    expect(
      parseDeclaration("Safety pattern: `feature-flagged`\nIdea:   "),
    ).toEqual({ ok: true, pattern: "feature-flagged", idea: undefined });
  });

  it("ignores a features line that is unchanged context", () => {
    const diff = overlay('   "features": { "a": false },', '+  "other": 1,');
    expect(hintsFor("feature-flagged", parseDiff(diff))).toMatchObject({
      flags: [],
    });
  });

  it("reads a flag added on the opening line of a multiline features object", () => {
    const diff = overlay(
      '+  "features": { "a": false,',
      '     "b": true',
      "   },",
    );
    expect(hintsFor("feature-flagged", parseDiff(diff))).toMatchObject({
      flags: [{ flag: "a", environment: "local", value: false }],
    });
  });

  it("reads a flag changed from on to off as the new value", () => {
    const diff = overlay(
      '-  "features": { "a": true },',
      '+  "features": { "a": false },',
    );
    expect(hintsFor("feature-flagged", parseDiff(diff))).toMatchObject({
      flagPresentAndOff: true,
    });
  });
});
