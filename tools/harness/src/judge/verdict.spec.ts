import { describe, expect, it } from "vitest";
import { parseDiff } from "./diff.js";
import { hintsFor } from "./hints.js";
import { assess, clusterFacing } from "./verdict.js";
import type { Pattern } from "./declaration.js";

const file = (path: string, body = "+x") =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n${body}`;

const overlay = (value: boolean, env = "local") =>
  [
    `diff --git a/infra/environments/${env}/environment.yaml b/infra/environments/${env}/environment.yaml`,
    `--- a/infra/environments/${env}/environment.yaml`,
    `+++ b/infra/environments/${env}/environment.yaml`,
    "@@ -1,2 +1,2 @@",
    `+  "features": { "gateway": ${value} },`,
  ].join("\n");

function assessed(pattern: Pattern, diff: string) {
  const files = parseDiff(diff);
  return assess(pattern, hintsFor(pattern, files), files);
}

describe("assess: a hint that contradicts the pattern fails it", () => {
  it("no-behaviour-change with a behavioural path is a mismatch naming the path", () => {
    const r = assessed("no-behaviour-change", file("tools/kore/src/a.ts"));
    expect(r.patternMatches).toBe(false);
    expect(r.patternMismatch).toContain("tools/kore/src/a.ts");
  });

  it("feature-flagged without a flag present and off is a mismatch", () => {
    const r = assessed("feature-flagged", file("tools/kore/src/a.ts"));
    expect(r).toMatchObject({ patternMatches: false });
    expect(r.patternMismatch).toContain("flag");
    expect(assessed("feature-flagged", overlay(true)).patternMatches).toBe(
      false,
    );
  });

  it("dark-launched is a mismatch unless the flag is on only in local", () => {
    expect(
      assessed("dark-launched", overlay(true, "prod")).patternMatches,
    ).toBe(false);
    expect(assessed("dark-launched", overlay(true)).patternMatches).toBe(true);
  });

  it("branch-by-abstraction is a mismatch when the diff deletes a file", () => {
    const gone = [
      "diff --git a/old.ts b/old.ts",
      "deleted file mode 100644",
      "--- a/old.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-x",
    ].join("\n");
    expect(assessed("branch-by-abstraction", gone).patternMatches).toBe(false);
  });

  it("expand-contract is a mismatch when the diff removes without replacing", () => {
    const r = assessed("expand-contract", file("a.ts", "-old\n-older"));
    expect(r.patternMatches).toBe(false);
    expect(r.patternMismatch).toContain("expand-contract");
    const gone = [
      "diff --git a/old.ts b/old.ts",
      "deleted file mode 100644",
      "--- a/old.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-x",
    ].join("\n");
    expect(assessed("expand-contract", gone).patternMatches).toBe(false);
  });

  it("expand-contract matches an additive diff and ignores the generated bundle", () => {
    const diff = [
      file("a.ts", "+new"),
      file("skills/bin/harness.mjs", "-a\n-b\n-c"),
    ].join("\n");
    expect(assessed("expand-contract", diff).patternMatches).toBe(true);
  });

  it("matching hints leave no mismatch reason", () => {
    const r = assessed("feature-flagged", overlay(false));
    expect(r.patternMatches).toBe(true);
    expect(r).not.toHaveProperty("patternMismatch");
  });
});

describe("assess: what the precheck cannot verify is listed", () => {
  it("lists gating as unverified for a flagged change", () => {
    expect(assessed("feature-flagged", overlay(false)).unverified).toContain(
      "gating not verified",
    );
  });

  it("requires a live run before merge for a cluster-facing no-behaviour-change", () => {
    const r = assessed("no-behaviour-change", file("apps/web/values.yaml"));
    expect(r.clusterFacing).toBe(true);
    expect(r.unverified).toContain(
      "cluster-facing: live run required before merge",
    );
  });

  it("requires live proof before activation for other cluster-facing patterns", () => {
    const diff = [overlay(false), file("infra/charts/x/values.yaml")].join(
      "\n",
    );
    const r = assessed("feature-flagged", diff);
    expect(r.unverified).toContain(
      "cluster-facing: live proof required before the flag turns on",
    );
  });
});

describe("clusterFacing", () => {
  it.each([
    "apps/web/deploy.yaml",
    "infra/environments/local/environment.yaml",
    "catalog/components.yaml",
    "tools/kore/charts/x/Chart.yaml",
  ])("treats %s as cluster-facing", (path) => {
    expect(clusterFacing(parseDiff(file(path)))).toBe(true);
  });

  it.each([
    "infra/plans/11-agent-delivery-loop.md",
    "docs/index.md",
    "tools/harness/src/judge/hints.ts",
  ])("does not treat %s as cluster-facing", (path) => {
    expect(clusterFacing(parseDiff(file(path)))).toBe(false);
  });
});

describe("assess: tooling under no-behaviour-change", () => {
  it("a diff whose only non-doc paths are tooling matches and is not cluster-facing", () => {
    const files = parseDiff(file("tools/harness/src/hook/guard.ts"));
    const r = assess(
      "no-behaviour-change",
      {
        behaviouralPaths: [],
        toolingPaths: ["tools/harness/src/hook/guard.ts"],
        noBehaviouralDiff: true,
      },
      files,
    );
    expect(r).toMatchObject({ patternMatches: true, clusterFacing: false });
    expect(r.patternMismatch).toBeUndefined();
  });
});
