import { describe, expect, it } from "vitest";
import { isTooling } from "./tooling.js";
import { add, ctx, del, file, withSides } from "./tooling.fixtures.js";

const path = "tools/kore/package.json";

/** A manifest's full text, with the sections the rule reads and one top-level key. */
const manifest = (sections: {
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}) =>
  JSON.stringify(
    {
      name: "kore",
      version: sections.version ?? "1.0.0",
      scripts: sections.scripts ?? { test: "vitest run" },
      dependencies: sections.dependencies ?? { yaml: "2.0.0" },
      devDependencies: sections.devDependencies ?? { vitest: "4.0.0" },
    },
    null,
    2,
  );

/** The PR 437 hunk: three lines of context, so no `"scripts": {` header is in view. */
const scriptsHunk = [
  [
    ctx('    "format:check": "prettier --check src",'),
    del('    "test": "vitest run --coverage",'),
    add('    "test": "vitest run --coverage && npm run test:budget",'),
    ctx('    "test:coverage": "vitest run --coverage",'),
  ],
];

describe("isTooling: tools/kore/package.json, judged on the full file", () => {
  it("is tooling for a scripts-only change whose hunk shows no section header (PR 437)", () => {
    const before = manifest({ scripts: { test: "vitest run --coverage" } });
    const after = manifest({
      scripts: { test: "vitest run --coverage && npm run test:budget" },
    });
    expect(isTooling(withSides(file(path, scriptsHunk), before, after))).toBe(
      true,
    );
  });

  it("is tooling for a devDependencies change", () => {
    const before = manifest({ devDependencies: { vitest: "4.0.0" } });
    const after = manifest({ devDependencies: { vitest: "4.0.1" } });
    expect(
      isTooling(
        withSides(
          file(path, [
            [
              ctx('  "devDependencies": {'),
              del('    "vitest": "4.0.0"'),
              add('    "vitest": "4.0.1"'),
            ],
          ]),
          before,
          after,
        ),
      ),
    ).toBe(true);
  });

  it("is tooling for a script added and another removed in one change", () => {
    const before = manifest({ scripts: { a: "x", b: "y" } });
    const after = manifest({ scripts: { a: "x", c: "z" } });
    expect(isTooling(withSides(file(path, scriptsHunk), before, after))).toBe(
      true,
    );
  });
});

describe("isTooling: tools/kore/package.json, product changes", () => {
  it("is product when runtime dependencies change", () => {
    const before = manifest({ dependencies: { yaml: "2.0.0" } });
    const after = manifest({
      dependencies: { yaml: "2.0.0", "left-pad": "1.0.0" },
    });
    expect(isTooling(withSides(file(path, scriptsHunk), before, after))).toBe(
      false,
    );
  });

  it("is product when a package moves from dependencies to devDependencies", () => {
    const before = manifest({
      dependencies: { yaml: "2.0.0" },
      devDependencies: { vitest: "4.0.0" },
    });
    const after = manifest({
      dependencies: {},
      devDependencies: { vitest: "4.0.0", yaml: "2.0.0" },
    });
    expect(isTooling(withSides(file(path, scriptsHunk), before, after))).toBe(
      false,
    );
  });

  it("is product when a top-level key changes beside a scripts change", () => {
    const before = manifest({ version: "1.0.0" });
    const after = manifest({
      version: "1.0.1",
      scripts: { test: "vitest run --coverage && npm run test:budget" },
    });
    expect(isTooling(withSides(file(path, scriptsHunk), before, after))).toBe(
      false,
    );
  });

  it("is product when a side is not known, so the precheck fails closed", () => {
    expect(
      isTooling(withSides(file(path, scriptsHunk), undefined, manifest({}))),
    ).toBe(false);
    expect(
      isTooling(withSides(file(path, scriptsHunk), manifest({}), undefined)),
    ).toBe(false);
    expect(isTooling(file(path, scriptsHunk))).toBe(false);
  });

  it("is product when a side does not parse as JSON", () => {
    expect(
      isTooling(withSides(file(path, scriptsHunk), "not json", manifest({}))),
    ).toBe(false);
  });

  it("is product when the diff has no hunks, as for a mode change or a binary diff", () => {
    const same = manifest({});
    expect(isTooling(withSides(file(path), same, same))).toBe(false);
  });
});
