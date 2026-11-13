import { describe, expect, it } from "vitest";
import { parsePrView } from "./checks.js";
import { parseDeclaration } from "./declaration.js";
import { parseDiff } from "./diff.js";
import { JudgeError } from "./errors.js";
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
      body: "",
      comments: [],
      headCommittedAt: undefined,
      headSha: "",
      rollup: [],
    });
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

  it("ignores text before the first diff header", () => {
    expect(parseDiff("noise\n+stray")).toEqual([]);
  });
});

describe("diff header reading", () => {
  it("reads a file whose quoted header has octal-escaped bytes under its unquoted path", () => {
    const diff = [
      'diff --git "a/apps/web/caf\\303\\251.yaml" "b/apps/web/caf\\303\\251.yaml"',
      '--- "a/apps/web/caf\\303\\251.yaml"',
      '+++ "b/apps/web/caf\\303\\251.yaml"',
      "@@ -1 +1 @@",
      "+name: cafe",
    ].join("\n");
    expect(parseDiff(diff)).toEqual([
      {
        path: "apps/web/café.yaml",
        deleted: false,
        added: ["name: cafe"],
        removed: 0,
        netRemoved: 0,
        after: [{ added: true, text: "name: cafe" }],
      },
    ]);
  });

  it("decodes a quoted backslash-escape in a header to its character", () => {
    const diff = [
      'diff --git "a/say \\"hi\\".yaml" "b/say \\"hi\\".yaml"',
      "@@ -1 +1 @@",
      "+x: 1",
    ].join("\n");
    expect(parseDiff(diff)).toMatchObject([{ path: 'say "hi".yaml' }]);
  });

  it("fails closed on a quoted header with an escape it does not know", () => {
    const diff = 'diff --git "a/x\\9.yaml" "b/x\\9.yaml"';
    expect(() => parseDiff(diff)).toThrow(
      new JudgeError(
        'Cannot read the diff header on this line, so the file it changes is unknown: diff --git "a/x\\9.yaml" "b/x\\9.yaml". Rename the file so git writes a plain header, or extend the header reader in tools/harness/src/judge/diff.ts to read this form.',
      ),
    );
  });

  it("fails closed on a header it cannot read, naming that line, and books no hunk to the file before it", () => {
    const diff = [
      "diff --git a/one.yaml b/one.yaml",
      "@@ -1 +1 @@",
      "+a: 1",
      'diff --git "a/two.yaml b/two.yaml',
      "@@ -1 +1 @@",
      "+b: 2",
    ].join("\n");
    expect(() => parseDiff(diff)).toThrow(
      new JudgeError(
        'Cannot read the diff header on this line, so the file it changes is unknown: diff --git "a/two.yaml b/two.yaml. Rename the file so git writes a plain header, or extend the header reader in tools/harness/src/judge/diff.ts to read this form.',
      ),
    );
  });
});

describe("diff headers that are ambiguous or unknown", () => {
  it("reads an unquoted path that contains ' b/' under the one path both sides name", () => {
    const diff = [
      "diff --git a/apps/web/templates/x b/docs/deploy.yaml b/apps/web/templates/x b/docs/deploy.yaml",
      "@@ -1 +1 @@",
      "+kind: Deployment",
    ].join("\n");
    expect(parseDiff(diff)).toMatchObject([
      { path: "apps/web/templates/x b/docs/deploy.yaml" },
    ]);
  });

  it("fails closed on an unquoted header whose split between the two paths is ambiguous", () => {
    const diff = "diff --git a/p b/q b/r";
    expect(() => parseDiff(diff)).toThrow(
      new JudgeError(
        "Cannot read the diff header on this line, so the file it changes is unknown: diff --git a/p b/q b/r. Rename the file so git writes a plain header, or extend the header reader in tools/harness/src/judge/diff.ts to read this form.",
      ),
    );
  });

  it("reads a plain rename under its new path", () => {
    expect(
      parseDiff("diff --git a/old.yaml b/new.yaml\n@@ -1 +1 @@\n+x: 1"),
    ).toMatchObject([{ path: "new.yaml" }]);
  });

  it("fails closed on a combined-diff header, which the reader does not handle", () => {
    const diff = [
      "diff --cc apps/web/x.yaml",
      "@@@ -1,1 -1,1 +1,1 @@@",
      "++name: y",
    ].join("\n");
    expect(() => parseDiff(diff)).toThrow(
      new JudgeError(
        "Cannot read the diff header on this line, so the file it changes is unknown: diff --cc apps/web/x.yaml. Rename the file so git writes a plain header, or extend the header reader in tools/harness/src/judge/diff.ts to read this form.",
      ),
    );
  });

  it("fails closed on a quoted path whose bytes are not valid UTF-8", () => {
    const diff = 'diff --git "a/x\\377.yaml" "b/x\\377.yaml"';
    expect(() => parseDiff(diff)).toThrow(
      new JudgeError(
        'Cannot read the diff header on this line, so the file it changes is unknown: diff --git "a/x\\377.yaml" "b/x\\377.yaml". Rename the file so git writes a plain header, or extend the header reader in tools/harness/src/judge/diff.ts to read this form.',
      ),
    );
  });
});

describe("diff headers among other files", () => {
  it("keeps an ordinary file's hunk on that file when a quoted file follows it", () => {
    const diff = [
      "diff --git a/one.yaml b/one.yaml",
      "@@ -1 +1 @@",
      "+a: 1",
      'diff --git "a/caf\\303\\251.yaml" "b/caf\\303\\251.yaml"',
      "@@ -1 +1 @@",
      "+b: 2",
    ].join("\n");
    expect(parseDiff(diff)).toMatchObject([
      { path: "one.yaml", added: ["a: 1"] },
      { path: "café.yaml", added: ["b: 2"] },
    ]);
  });

  it("keeps a quoted file's hunk on that file when an ordinary file follows it", () => {
    const diff = [
      'diff --git "a/caf\\303\\251.yaml" "b/caf\\303\\251.yaml"',
      "@@ -1 +1 @@",
      "+b: 2",
      "diff --git a/one.yaml b/one.yaml",
      "@@ -1 +1 @@",
      "+a: 1",
    ].join("\n");
    expect(parseDiff(diff)).toMatchObject([
      { path: "café.yaml", added: ["b: 2"] },
      { path: "one.yaml", added: ["a: 1"] },
    ]);
  });

  it("decodes backslash, tab and newline escapes in a quoted path", () => {
    const diff = [
      'diff --git "a/a\\\\b\\tc\\nd.yaml" "b/a\\\\b\\tc\\nd.yaml"',
      "@@ -1 +1 @@",
      "+x: 1",
    ].join("\n");
    expect(parseDiff(diff)).toMatchObject([{ path: "a\\b\tc\nd.yaml" }]);
  });

  it("reads a rename from a quoted old path to a bare new path under the new path", () => {
    const diff = [
      'diff --git "a/caf\\303\\251.yaml" b/cafe.yaml',
      "@@ -1 +1 @@",
      "+x: 1",
    ].join("\n");
    expect(parseDiff(diff)).toMatchObject([{ path: "cafe.yaml" }]);
  });
});
