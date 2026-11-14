import { describe, expect, it } from "vitest";
import { isTooling } from "./tooling.js";
import { add, ctx, del, file } from "./tooling.fixtures.js";

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
    ".github/workflows/integration.yml",
    "tools/kore/integration-setup.ts",
    "tools/kore/integration/ops/ops-support.ts",
    "tools/kore/integration/app-up.spec.ts",
    ".mise.toml",
    "tools/kore/src/testing/mock.ts",
    "tools/kore/src/app/app-fixtures.ts",
    "tools/kore/src/cli/cli-dispatch.fixtures.ts",
    "tools/kore/src/cli/runner-support.ts",
    "tools/kore/src/cli/unconverted.txt",
    "apps/web/unconverted.txt",
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
    ".github/workflows/merge.yml",
    "docs/.github/workflows/integration.yml",
    "apps/web/integration-setup.ts",
    "tools/kore/src/integration-setup.ts",
    "mise.toml.bak",
    "infra/.mise.toml",
    ".mise.toml.bak",
    ".Claude/x",
    "tools/kore/tsconfig.json",
    "tools/kore/.npmrc",
    "tools/kore/src/cli/unconverted.txt.bak",
    "tools/kore/src/cli/unconverted-list.ts",
    "tools/kore/src/cli/cli.ts",
    "tools/kore/integration-notes/x.ts",
    "tools/kore/integration.ts",
    "tools/kore/src/integration/x.ts",
    "tools/kore/src/ops/integration/ops.ts",
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

  it("is tooling when a test-support file moves from tools/kore/src into tools/kore/integration", () => {
    expect(
      isTooling(
        file(
          "tools/kore/integration/ops/ops-support.ts",
          [],
          "tools/kore/src/ops/upgrade.fixtures.ts",
        ),
      ),
    ).toBe(true);
  });

  it("is product when a production file moves into tools/kore/integration", () => {
    expect(
      isTooling(
        file(
          "tools/kore/integration/ops/ops.ts",
          [],
          "tools/kore/src/ops/ops.ts",
        ),
      ),
    ).toBe(false);
  });

  it("is product when package.json is renamed", () => {
    expect(isTooling(file("tools/kore/package.json", [], "package.json"))).toBe(
      false,
    );
  });
});

describe("isTooling: .gitignore", () => {
  it("is tooling when its only change adds the test-results ignore line", () => {
    expect(
      isTooling(
        file(".gitignore", [
          [ctx("skills/bin/harness.mjs.*.tmp"), add("test-results/")],
        ]),
      ),
    ).toBe(true);
  });

  it.each([
    ["adds another ignore line", [add("cosign.key")]],
    ["removes the test-results line", [del("test-results/")]],
    [
      "adds the test-results line beside another line",
      [add("test-results/"), add("secrets.txt")],
    ],
  ])("is product when it %s", (_, lines) => {
    expect(isTooling(file(".gitignore", [lines]))).toBe(false);
  });
});
