import { describe, expect, it } from "vitest";
import { isTooling } from "./tooling.js";
import { file } from "./tooling.fixtures.js";

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
    "infra/charts/x/values.yaml",
    "catalog/a.yaml",
    "something/else.ts",
    "x/tools/harness/a.ts",
    "tools/kore/src/foo-support.ts.bak",
    "tools/kore/src/cli/testing/x.ts",
    "tools/kore/src/x.config.ts",
    ".github/workflows/check.yml.bak",
    ".Claude/x",
    "tools/kore/tsconfig.json",
    "tools/kore/.npmrc",
  ])("%s is product", (path) => {
    expect(isTooling(file(path))).toBe(false);
  });
});

describe("isTooling: renames", () => {
  it("is tooling when both the old and the new path are tooling", () => {
    expect(isTooling(file("skills/b.md", [], "tools/harness/a.ts"))).toBe(true);
  });

  it("is product when a product file is renamed into a tooling name", () => {
    expect(
      isTooling(
        file("tools/kore/src/gate-support.ts", [], "tools/kore/src/gate.ts"),
      ),
    ).toBe(false);
    expect(
      isTooling(file("skills/values.yaml", [], "apps/web/values.yaml")),
    ).toBe(false);
  });

  it("is product when package.json is renamed", () => {
    expect(isTooling(file("tools/kore/package.json", [], "package.json"))).toBe(
      false,
    );
  });
});
