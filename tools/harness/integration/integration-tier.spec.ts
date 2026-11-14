// The integration tier has one config per package, and one explicit command
// per package runs it. The guard-bundle startup spec is the tier's one moved
// test, and the nightly workflow runs the tier. Docs: infra/plans/14-test-tiers.md, ADR 0098.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const harness = resolve(here, "..");
const kore = resolve(here, "../../kore");
const repo = resolve(here, "../../..");

type Config = { test: { include?: string[]; exclude?: string[] } };

const scriptsOf = (dir: string) =>
  (
    JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts;

const matchesAny = (patterns: string[] | undefined, file: string) =>
  (patterns ?? []).some((pattern) => matchesGlob(file, pattern));

it("runs the guard-bundle startup spec from the harness integration config", async () => {
  const { default: config } = (await import(
    join(harness, "vitest.integration.config.ts")
  )) as { default: Config };

  expect(
    matchesAny(config.test.include, "integration/guard-bundle.spec.ts"),
  ).toBe(true);
});

it("runs the integration tier one file at a time, with the hook-case timeout", async () => {
  const { default: config } = (await import(
    join(harness, "vitest.integration.config.ts")
  )) as {
    default: { test: { fileParallelism?: boolean; testTimeout?: number } };
  };

  expect(config.test.fileParallelism).toBe(false);
  expect(config.test.testTimeout).toBe(60_000);
});

it("moves the guard-bundle startup spec out of tests/, and out of the default bundle run", async () => {
  expect(existsSync(join(harness, "tests/guard-bundle.spec.ts"))).toBe(false);
  expect(existsSync(join(harness, "integration/guard-bundle.spec.ts"))).toBe(
    true,
  );

  const { default: config } = (await import(
    join(harness, "vitest.config.ts")
  )) as {
    default: {
      test: { projects: { test: Config["test"] & { name: string } }[] };
    };
  };
  const bundle = config.test.projects.find((p) => p.test.name === "bundle");

  expect(matchesAny(bundle?.test.include, "tests/guard-bundle.spec.ts")).toBe(
    false,
  );
});

it("gives kore an integration config that picks up integration specs only", async () => {
  const { default: config } = (await import(
    join(kore, "vitest.integration.config.ts")
  )) as { default: Config };

  expect(matchesAny(config.test.include, "integration/a.ts")).toBe(true);
  expect(matchesAny(config.test.include, "src/a.spec.ts")).toBe(false);
});

it("runs each package's integration tier from its own test:integration script", () => {
  expect(scriptsOf(harness)["test:integration"]).toBe(
    "vitest run --config vitest.integration.config.ts",
  );
  expect(scriptsOf(kore)["test:integration"]).toBe(
    "vitest run --config vitest.integration.config.ts --passWithNoTests",
  );
});

it("runs both packages' tiers from one local command", () => {
  const mise = readFileSync(join(repo, ".mise.toml"), "utf8");

  expect(mise).toMatch(
    /\[tasks\.test-integration\]\n(?:.*\n)*?run = \["npm --prefix tools\/kore run test:integration", "npm --prefix tools\/harness run test:integration"\]/,
  );
});

it("runs the integration tier in the nightly workflow, so its result shows in the run", () => {
  const nightly = readFileSync(
    join(repo, ".github/workflows/nightly.yml"),
    "utf8",
  );

  expect(nightly).toMatch(/^\s+run: mise run test-integration$/m);
});

it("runs the tier in the merge check for a change to the commit hooks or the hook scripts and tests, and for no other agent configuration", () => {
  const workflow = readFileSync(
    join(repo, ".github/workflows/integration.yml"),
    "utf8",
  );
  const filter = /grep -qE '([^']+)'/.exec(workflow)?.[1];
  expect(filter).toBeDefined();
  const triggers = new RegExp(filter ?? "");

  for (const path of [
    ".claude/hooks/guard.test.mjs",
    ".claude/evals/eval.test.mjs",
    "tools/kore/.husky/pre-commit",
    "tools/harness/src/hook/guard.ts",
  ]) {
    expect(triggers.test(path), path).toBe(true);
  }
  // Coverage trade-off (owner decision): these run no tier in the merge check; the
  // nightly integration job covers them after merge.
  for (const path of [
    ".claude/settings.json",
    ".claude/agents/reviewer.md",
    "skills/handoff/SKILL.md",
    ".codex/config.toml",
    "tools/kore/src/runtime/runner.ts",
    "tools/harness/src/judge/verdict.ts",
    "docs/index.md",
  ]) {
    expect(triggers.test(path), path).toBe(false);
  }
});
