import { describe, expect, it } from "vitest";
import type { ChangedFile } from "./diff.js";
import { isTooling } from "./tooling.js";

const file = (
  path: string,
  lines: { added: boolean; text: string }[] = [],
  removed = 0,
): ChangedFile => ({
  path,
  deleted: false,
  added: lines.filter((l) => l.added).map((l) => l.text),
  removed,
  netRemoved: Math.max(0, removed - lines.filter((l) => l.added).length),
  after: lines,
});

const add = (text: string) => ({ added: true, text });
const ctx = (text: string) => ({ added: false, text });

describe("isTooling: paths", () => {
  it.each([
    "tools/harness/src/judge/hints.ts",
    ".claude/agents/judge.md",
    "skills/x/SKILL.md",
    "tools/kore/tests/a.ts",
    "tools/kore/.husky/pre-commit",
    "tools/kore/scripts/x.sh",
    "tools/kore/vitest.config.ts",
    "tools/kore/lint-staged.config.js",
    ".github/workflows/check.yml",
    ".github/workflows/nightly.yml",
    "tools/kore/src/testing/mock.ts",
    "tools/kore/src/app/app-fixtures.ts",
    "tools/kore/src/cli/cli-dispatch.fixtures.ts",
    "tools/kore/src/cli/runner-support.ts",
  ])("%s is tooling", (path) => {
    expect(isTooling(file(path))).toBe(true);
  });

  it.each([
    "tools/kore/src/cli/main.ts",
    ".github/workflows/release.yaml",
    "apps/web/values.yaml",
    "infra/environments/local/environment.yaml",
    "catalog/a.yaml",
    "something/else.ts",
  ])("%s is product", (path) => {
    expect(isTooling(file(path))).toBe(false);
  });
});

describe("isTooling: tools/kore/package.json", () => {
  const path = "tools/kore/package.json";

  it("is tooling when only scripts or devDependencies change", () => {
    const f = file(
      path,
      [
        ctx('  "devDependencies": {'),
        add('    "vitest": "4.0.1",'),
        ctx("  },"),
      ],
      1,
    );
    expect(isTooling(f)).toBe(true);
    expect(
      isTooling(
        file(path, [ctx('  "scripts": {'), add('    "x": "y",'), ctx("  }")]),
      ),
    ).toBe(true);
  });

  it("is product when runtime dependencies change", () => {
    const f = file(path, [
      ctx('  "dependencies": {'),
      add('    "left-pad": "1.0.0"'),
      ctx("  }"),
    ]);
    expect(isTooling(f)).toBe(false);
  });

  it("is product when a line is only removed, since where it sat is unknown", () => {
    expect(isTooling(file(path, [ctx('  "devDependencies": {')], 1))).toBe(
      false,
    );
  });

  it("is product when an added line has no section header in view", () => {
    expect(isTooling(file(path, [add('    "vitest": "4.0.1",')]))).toBe(false);
  });
});

describe("isTooling: tools/kore/package-lock.json", () => {
  const path = "tools/kore/package-lock.json";

  it("is tooling when every changed package entry is dev only", () => {
    const f = file(path, [
      ctx('    "node_modules/vitest": {'),
      add('      "version": "4.0.1",'),
      ctx('      "dev": true,'),
    ]);
    expect(isTooling(f)).toBe(true);
  });

  it("is product when a changed package entry is not dev only", () => {
    const f = file(path, [
      ctx('    "node_modules/left-pad": {'),
      add('      "version": "1.0.0",'),
      ctx('      "license": "MIT"'),
    ]);
    expect(isTooling(f)).toBe(false);
  });

  it("is product when a change has no package entry in view", () => {
    expect(isTooling(file(path, [add('      "version": "1.0.0",')]))).toBe(
      false,
    );
  });
});
