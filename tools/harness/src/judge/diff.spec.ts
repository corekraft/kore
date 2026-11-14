import { describe, expect, it } from "vitest";
import { parseDiff } from "./diff.js";
import { JudgeError } from "./errors.js";

describe("parseDiff: renames and hunks", () => {
  it("keeps the path a file was renamed from", () => {
    const [file] = parseDiff(
      [
        "diff --git a/platform/gate.ts b/platform/gate-support.ts",
        "similarity index 90%",
        "rename from platform/gate.ts",
        "rename to platform/gate-support.ts",
      ].join("\n"),
    );
    expect(file).toMatchObject({
      path: "platform/gate-support.ts",
      previousPath: "platform/gate.ts",
    });
  });

  it("gives an unrenamed file the same previous path", () => {
    const [file] = parseDiff("diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n+x");
    expect(file?.previousPath).toBe("a.ts");
  });

  it("records every changed and context line in order, marking where each hunk starts", () => {
    const [file] = parseDiff(
      [
        "diff --git a/a.ts b/a.ts",
        "@@ -1,2 +1,2 @@",
        " keep",
        "-old",
        "+new",
        "@@ -9,1 +9,2 @@",
        "+later",
        " tail",
      ].join("\n"),
    );
    expect(file?.trail).toEqual([
      { kind: "context", text: "keep", start: true },
      { kind: "removed", text: "old", start: false },
      { kind: "added", text: "new", start: false },
      { kind: "added", text: "later", start: true },
      { kind: "context", text: "tail", start: false },
    ]);
  });

  it("marks a hunk that only removes lines", () => {
    const [file] = parseDiff(
      "diff --git a/a.ts b/a.ts\n@@ -1,2 +1 @@\n-gone\n keep",
    );
    expect(file?.trail[0]).toEqual({
      kind: "removed",
      text: "gone",
      start: true,
    });
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
        previousPath: "apps/web/café.yaml",
        deleted: false,
        added: ["name: cafe"],
        removed: 0,
        netRemoved: 0,
        after: [{ added: true, text: "name: cafe" }],
        trail: [{ kind: "added", text: "name: cafe", start: true }],
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
  it("fails closed on an unquoted header with more than one ' b/' split, even when one split has equal paths", () => {
    const diff = [
      "diff --git a/apps/web/templates/x b/docs/deploy.yaml b/apps/web/templates/x b/docs/deploy.yaml",
      "@@ -1 +1 @@",
      "+kind: Deployment",
    ].join("\n");
    expect(() => parseDiff(diff)).toThrow(
      new JudgeError(
        "Cannot read the diff header on this line, so the file it changes is unknown: diff --git a/apps/web/templates/x b/docs/deploy.yaml b/apps/web/templates/x b/docs/deploy.yaml. Rename the file so git writes a plain header, or extend the header reader in tools/harness/src/judge/diff.ts to read this form.",
      ),
    );
  });

  it("fails closed on an unquoted header with four ' b/' splits", () => {
    expect(() => parseDiff("diff --git a/x b/x b/x b/x")).toThrow(
      new JudgeError(
        "Cannot read the diff header on this line, so the file it changes is unknown: diff --git a/x b/x b/x b/x. Rename the file so git writes a plain header, or extend the header reader in tools/harness/src/judge/diff.ts to read this form.",
      ),
    );
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

  it("ignores text before the first diff header", () => {
    expect(parseDiff("noise\n+stray")).toEqual([]);
  });
});

describe("diff header previous paths", () => {
  it("reads the path a quoted old header was renamed from, decoded like the new path", () => {
    const diff = [
      'diff --git "a/caf\\303\\251.yaml" "b/cafe.yaml"',
      "@@ -1 +1 @@",
      "+x: 1",
    ].join("\n");
    expect(parseDiff(diff)).toMatchObject([
      { path: "cafe.yaml", previousPath: "café.yaml" },
    ]);
  });

  it("reads the decoded old path of a quoted old header with a bare new path", () => {
    const diff = [
      'diff --git "a/caf\\303\\251.yaml" b/cafe.yaml',
      "@@ -1 +1 @@",
      "+x: 1",
    ].join("\n");
    expect(parseDiff(diff)).toMatchObject([
      { path: "cafe.yaml", previousPath: "café.yaml" },
    ]);
  });

  it("reads the bare old path of a rename to a quoted new path", () => {
    const diff = [
      'diff --git a/old.yaml "b/new\\303\\251.yaml"',
      "@@ -1 +1 @@",
      "+x: 1",
    ].join("\n");
    expect(parseDiff(diff)).toMatchObject([
      { path: "newé.yaml", previousPath: "old.yaml" },
    ]);
  });

  it("reads the bare old path of a plain rename under that path", () => {
    expect(
      parseDiff("diff --git a/old.yaml b/new.yaml\n@@ -1 +1 @@\n+x: 1"),
    ).toMatchObject([{ path: "new.yaml", previousPath: "old.yaml" }]);
  });

  it("fails closed on an unknown escape in the quoted old path, though the new path reads", () => {
    const diff = 'diff --git "a/x\\9.yaml" "b/ok.yaml"';
    expect(() => parseDiff(diff)).toThrow(
      new JudgeError(
        'Cannot read the diff header on this line, so the file it changes is unknown: diff --git "a/x\\9.yaml" "b/ok.yaml". Rename the file so git writes a plain header, or extend the header reader in tools/harness/src/judge/diff.ts to read this form.',
      ),
    );
  });

  it("fails closed on quoted old-path bytes that are not valid UTF-8, though the new path reads", () => {
    const diff = 'diff --git "a/x\\377.yaml" "b/ok.yaml"';
    expect(() => parseDiff(diff)).toThrow(
      new JudgeError(
        'Cannot read the diff header on this line, so the file it changes is unknown: diff --git "a/x\\377.yaml" "b/ok.yaml". Rename the file so git writes a plain header, or extend the header reader in tools/harness/src/judge/diff.ts to read this form.',
      ),
    );
  });
});

describe("parseDiff marks a deleted file", () => {
  it("marks a file whose header says it was deleted, and counts its removed lines", () => {
    const diff =
      "diff --git a/old.ts b/old.ts\ndeleted file mode 100644\n@@ -1 +0,0 @@\n-x";
    expect(parseDiff(diff)[0]).toMatchObject({ deleted: true, removed: 1 });
  });
});
