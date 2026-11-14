import { describe, expect, it } from "vitest";
import { parseDiff } from "./diff.js";

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
