import { describe, expect, it, vi } from "vitest";
import { parseDiff, type ChangedFile } from "./diff.js";
import { hintsFor } from "./hints.js";

vi.mock("./tooling.js", () => ({ isTooling: () => false }));

const changed = (path: string, previousPath = path): ChangedFile => ({
  path,
  previousPath,
  deleted: false,
  added: [],
  removed: 0,
  netRemoved: 0,
  after: [],
  trail: [],
});

const overlay = (env: string, flag: string, value: boolean) =>
  [
    `diff --git a/infra/environments/${env}/environment.yaml b/infra/environments/${env}/environment.yaml`,
    `--- a/infra/environments/${env}/environment.yaml`,
    `+++ b/infra/environments/${env}/environment.yaml`,
    "@@ -1,3 +1,4 @@",
    '   "features": {',
    `+    "${flag}": ${value},`,
    "   }",
  ].join("\n");

const inline = (env: string, line: string) =>
  [
    `diff --git a/infra/environments/${env}/environment.yaml b/infra/environments/${env}/environment.yaml`,
    `--- a/infra/environments/${env}/environment.yaml`,
    `+++ b/infra/environments/${env}/environment.yaml`,
    "@@ -10,3 +10,3 @@",
    '   "registry": { "address": "10.96.0.50:5000" },',
    `+${line}`,
    '   "imageInventory": "audit",',
  ].join("\n");

const edit = (path: string, added: number, removed: number) =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,1 +1,1 @@",
    ...Array.from({ length: removed }, () => "-old"),
    ...Array.from({ length: added }, () => "+new"),
  ].join("\n");

const removal = (path: string) =>
  [
    `diff --git a/${path} b/${path}`,
    "deleted file mode 100644",
    `--- a/${path}`,
    "+++ /dev/null",
    "@@ -1,1 +0,0 @@",
    "-old",
  ].join("\n");

describe("hintsFor", () => {
  it("no-behaviour-change: a docs and test only diff has no behavioural diff", () => {
    expect(
      hintsFor("no-behaviour-change", [
        changed("docs/index.md"),
        changed("src/a.spec.ts"),
      ]),
    ).toEqual({
      behaviouralPaths: [],
      toolingPaths: [],
      noBehaviouralDiff: true,
    });
  });

  it("no-behaviour-change: names the files that change behaviour", () => {
    expect(
      hintsFor("no-behaviour-change", [
        changed("docs/index.md"),
        changed("tools/kore/src/a.ts"),
      ]),
    ).toEqual({
      behaviouralPaths: ["tools/kore/src/a.ts"],
      toolingPaths: [],
      noBehaviouralDiff: false,
    });
  });

  it("feature-flagged: reports a flag added and off", () => {
    const diff = parseDiff(overlay("local", "gateway", false));
    expect(hintsFor("feature-flagged", diff)).toEqual({
      flags: [{ flag: "gateway", environment: "local", value: false }],
      flagPresentAndOff: true,
    });
  });

  it("feature-flagged: a flag turned on in the diff is not off", () => {
    const diff = parseDiff(overlay("local", "gateway", true));
    expect(hintsFor("feature-flagged", diff)).toMatchObject({
      flagPresentAndOff: false,
    });
  });

  it("feature-flagged: no flag in the diff is not present", () => {
    const diff = parseDiff(edit("tools/kore/src/a.ts", 1, 0));
    expect(hintsFor("feature-flagged", diff)).toEqual({
      flags: [],
      flagPresentAndOff: false,
    });
  });
});

describe("hintsFor flags and structure", () => {
  it("dark-launched: on in local and off elsewhere", () => {
    const diff = parseDiff(
      [
        overlay("local", "gateway", true),
        overlay("prod", "gateway", false),
      ].join("\n"),
    );
    expect(hintsFor("dark-launched", diff)).toMatchObject({
      flagOnlyInLocal: true,
    });
  });

  it("dark-launched: on outside local is not a dark launch", () => {
    const diff = parseDiff(overlay("prod", "gateway", true));
    expect(hintsFor("dark-launched", diff)).toMatchObject({
      flagOnlyInLocal: false,
    });
  });

  it("branch-by-abstraction: retains the old path unless a file is deleted", () => {
    expect(
      hintsFor("branch-by-abstraction", parseDiff(edit("a.ts", 3, 0))),
    ).toEqual({ deletedFiles: [], oldPathRetained: true });
    expect(
      hintsFor("branch-by-abstraction", parseDiff(removal("old.ts"))),
    ).toEqual({ deletedFiles: ["old.ts"], oldPathRetained: false });
  });

  it("expand-contract: additive diffs expand, removals contract", () => {
    expect(hintsFor("expand-contract", parseDiff(edit("a.ts", 2, 0)))).toEqual({
      removedLines: 0,
      netRemovedLines: 0,
      deletedFiles: [],
      additiveOnly: true,
    });
    expect(hintsFor("expand-contract", parseDiff(removal("old.ts")))).toEqual({
      removedLines: 1,
      netRemovedLines: 1,
      deletedFiles: ["old.ts"],
      additiveOnly: false,
    });
  });
});

// The line copied from infra/environments/local/environment.yaml.
const REAL_LINE = '  "features": { "ingress-agentgateway": false },';

describe("hintsFor reads the features object of an overlay", () => {
  it("reads the real inline overlay format", () => {
    expect(
      hintsFor("feature-flagged", parseDiff(inline("local", REAL_LINE))),
    ).toEqual({
      flags: [
        { flag: "ingress-agentgateway", environment: "local", value: false },
      ],
      flagPresentAndOff: true,
    });
  });

  it("reads several inline flags on one line", () => {
    const line = '  "features": { "a": false, "b": true },';
    expect(
      hintsFor("feature-flagged", parseDiff(inline("local", line))),
    ).toMatchObject({
      flags: [
        { flag: "a", environment: "local", value: false },
        { flag: "b", environment: "local", value: true },
      ],
      flagPresentAndOff: false,
    });
  });

  it("does not count a boolean outside the features object as a flag", () => {
    const outside = inline("local", '  "imageInventory": true,');
    expect(hintsFor("feature-flagged", parseDiff(outside))).toEqual({
      flags: [],
      flagPresentAndOff: false,
    });
    const after = parseDiff(
      [
        "diff --git a/infra/environments/local/environment.yaml b/infra/environments/local/environment.yaml",
        "--- a/infra/environments/local/environment.yaml",
        "+++ b/infra/environments/local/environment.yaml",
        "@@ -1,5 +1,6 @@",
        '   "features": {',
        '     "a": false',
        "   },",
        '+  "enabled": true,',
      ].join("\n"),
    );
    expect(hintsFor("feature-flagged", after)).toMatchObject({ flags: [] });
  });

  it("does not read a boolean in another file's features-like text", () => {
    const other = parseDiff(
      edit("tools/kore/src/a.ts", 1, 0).replace("+new", '+  "x": true,'),
    );
    expect(hintsFor("feature-flagged", other)).toMatchObject({ flags: [] });
  });
});

describe("hintsFor expand-contract counts net removals", () => {
  it("treats replacing a line as additive: nothing is removed without a replacement", () => {
    expect(
      hintsFor("expand-contract", parseDiff(edit("a.ts", 1, 1))),
    ).toMatchObject({
      removedLines: 1,
      netRemovedLines: 0,
      additiveOnly: true,
    });
  });

  it("counts a hunk that removes more than it adds", () => {
    expect(
      hintsFor("expand-contract", parseDiff(edit("a.ts", 1, 3))),
    ).toMatchObject({
      netRemovedLines: 2,
      additiveOnly: false,
    });
  });

  it("leaves the generated bundle out of the removed lines", () => {
    const diff = parseDiff(
      [edit("skills/bin/harness.mjs", 5, 500), edit("a.ts", 2, 0)].join("\n"),
    );
    expect(hintsFor("expand-contract", diff)).toMatchObject({
      removedLines: 0,
      netRemovedLines: 0,
      additiveOnly: true,
    });
  });
});
