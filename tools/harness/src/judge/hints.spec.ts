import { describe, expect, it, vi } from "vitest";
import type { ChangedFile } from "./diff.js";
import { hintsFor } from "./hints.js";
import { add, ctx, del, file } from "./tooling.fixtures.js";

vi.mock("./tooling.js", () => ({ isTooling: () => false }));

// The changed files are built from their hunks; the diff text is read by diff.spec.ts and the PR-level spec.
const overlay = (env: string, flag: string, value: boolean): ChangedFile =>
  file(`infra/environments/${env}/environment.yaml`, [
    [ctx('  "features": {'), add(`    "${flag}": ${value},`), ctx("  }")],
  ]);

const inline = (env: string, line: string): ChangedFile =>
  file(`infra/environments/${env}/environment.yaml`, [
    [
      ctx('  "registry": { "address": "10.96.0.50:5000" },'),
      add(line),
      ctx('  "imageInventory": "audit",'),
    ],
  ]);

const edit = (path: string, added: number, removed: number): ChangedFile =>
  file(path, [
    [
      ...Array.from({ length: removed }, () => del("old")),
      ...Array.from({ length: added }, () => add("new")),
    ],
  ]);

const removal = (path: string): ChangedFile => ({
  ...file(path, [[del("old")]]),
  deleted: true,
});

describe("hintsFor no-behaviour-change", () => {
  it("a docs and test only diff has no behavioural diff", () => {
    expect(
      hintsFor("no-behaviour-change", [
        file("docs/index.md"),
        file("src/a.spec.ts"),
      ]),
    ).toEqual({
      behaviouralPaths: [],
      toolingPaths: [],
      noBehaviouralDiff: true,
    });
  });

  it("names the files that change behaviour", () => {
    expect(
      hintsFor("no-behaviour-change", [
        file("docs/index.md"),
        file("tools/kore/src/a.ts"),
      ]),
    ).toEqual({
      behaviouralPaths: ["tools/kore/src/a.ts"],
      toolingPaths: [],
      noBehaviouralDiff: false,
    });
  });
});

describe("hintsFor feature-flagged", () => {
  it("reports a flag added and off", () => {
    expect(
      hintsFor("feature-flagged", [overlay("local", "gateway", false)]),
    ).toEqual({
      flags: [{ flag: "gateway", environment: "local", value: false }],
      flagPresentAndOff: true,
    });
  });

  it("a flag turned on in the diff is not off", () => {
    expect(
      hintsFor("feature-flagged", [overlay("local", "gateway", true)]),
    ).toMatchObject({
      flagPresentAndOff: false,
    });
  });

  it("no flag in the diff is not present", () => {
    expect(
      hintsFor("feature-flagged", [edit("tools/kore/src/a.ts", 1, 0)]),
    ).toEqual({ flags: [], flagPresentAndOff: false });
  });

  it("ignores a features line that is unchanged context", () => {
    const changed = file("infra/environments/local/environment.yaml", [
      [ctx('  "features": { "a": false },'), add('  "other": 1,')],
    ]);
    expect(hintsFor("feature-flagged", [changed])).toMatchObject({ flags: [] });
  });

  it("reads a flag added on the opening line of a multiline features object", () => {
    const changed = file("infra/environments/local/environment.yaml", [
      [add('  "features": { "a": false,'), ctx('     "b": true'), ctx("   },")],
    ]);
    expect(hintsFor("feature-flagged", [changed])).toMatchObject({
      flags: [{ flag: "a", environment: "local", value: false }],
    });
  });

  it("reads a flag changed from on to off as the new value", () => {
    const changed = file("infra/environments/local/environment.yaml", [
      [
        del('  "features": { "a": true },'),
        add('  "features": { "a": false },'),
      ],
    ]);
    expect(hintsFor("feature-flagged", [changed])).toMatchObject({
      flagPresentAndOff: true,
    });
  });
});

describe("hintsFor reads the features object of an overlay", () => {
  // The line copied from infra/environments/local/environment.yaml.
  const REAL_LINE = '  "features": { "ingress-agentgateway": false },';

  it("reads the real inline overlay format", () => {
    expect(hintsFor("feature-flagged", [inline("local", REAL_LINE)])).toEqual({
      flags: [
        { flag: "ingress-agentgateway", environment: "local", value: false },
      ],
      flagPresentAndOff: true,
    });
  });

  it("reads several inline flags on one line", () => {
    const line = '  "features": { "a": false, "b": true },';
    expect(hintsFor("feature-flagged", [inline("local", line)])).toEqual({
      flags: [
        { flag: "a", environment: "local", value: false },
        { flag: "b", environment: "local", value: true },
      ],
      flagPresentAndOff: false,
    });
  });

  it("does not count a boolean outside the features object as a flag", () => {
    expect(
      hintsFor("feature-flagged", [
        inline("local", '  "imageInventory": true,'),
      ]),
    ).toEqual({ flags: [], flagPresentAndOff: false });
  });

  it("does not count a boolean added after the features object closes", () => {
    const changed = file("infra/environments/local/environment.yaml", [
      [
        ctx('  "features": {'),
        ctx('    "a": false'),
        ctx("  },"),
        add('  "enabled": true,'),
      ],
    ]);
    expect(hintsFor("feature-flagged", [changed])).toMatchObject({ flags: [] });
  });

  it("does not read a boolean in another file's features-like text", () => {
    const other = file("tools/kore/src/a.ts", [[add('  "x": true,')]]);
    expect(hintsFor("feature-flagged", [other])).toMatchObject({ flags: [] });
  });
});

describe("hintsFor dark-launched and branch-by-abstraction", () => {
  it("dark-launched: on in local and off elsewhere", () => {
    expect(
      hintsFor("dark-launched", [
        overlay("local", "gateway", true),
        overlay("prod", "gateway", false),
      ]),
    ).toMatchObject({ flagOnlyInLocal: true });
  });

  it("dark-launched: on outside local is not a dark launch", () => {
    expect(
      hintsFor("dark-launched", [overlay("prod", "gateway", true)]),
    ).toMatchObject({ flagOnlyInLocal: false });
  });

  it("branch-by-abstraction: retains the old path unless a file is deleted", () => {
    expect(hintsFor("branch-by-abstraction", [edit("a.ts", 3, 0)])).toEqual({
      deletedFiles: [],
      oldPathRetained: true,
    });
    expect(hintsFor("branch-by-abstraction", [removal("old.ts")])).toEqual({
      deletedFiles: ["old.ts"],
      oldPathRetained: false,
    });
  });
});

describe("hintsFor expand-contract counts net removals", () => {
  it("additive diffs expand, and removals contract", () => {
    expect(hintsFor("expand-contract", [edit("a.ts", 2, 0)])).toEqual({
      removedLines: 0,
      netRemovedLines: 0,
      deletedFiles: [],
      additiveOnly: true,
    });
    expect(hintsFor("expand-contract", [removal("old.ts")])).toEqual({
      removedLines: 1,
      netRemovedLines: 1,
      deletedFiles: ["old.ts"],
      additiveOnly: false,
    });
  });

  it("treats replacing a line as additive: nothing is removed without a replacement", () => {
    expect(hintsFor("expand-contract", [edit("a.ts", 1, 1)])).toMatchObject({
      removedLines: 1,
      netRemovedLines: 0,
      additiveOnly: true,
    });
  });

  it("counts a hunk that removes more than it adds", () => {
    expect(hintsFor("expand-contract", [edit("a.ts", 1, 3)])).toMatchObject({
      netRemovedLines: 2,
      additiveOnly: false,
    });
  });

  it("leaves the generated bundle out of the removed lines", () => {
    expect(
      hintsFor("expand-contract", [
        edit("skills/bin/harness.mjs", 5, 500),
        edit("a.ts", 2, 0),
      ]),
    ).toMatchObject({
      removedLines: 0,
      netRemovedLines: 0,
      additiveOnly: true,
    });
  });
});
