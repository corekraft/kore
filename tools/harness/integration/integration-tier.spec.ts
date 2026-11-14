// The integration tier has one config per package, and one explicit command
// per package runs it. The guard-bundle startup spec is the tier's one moved
// test, and the nightly workflow runs the tier. Docs: infra/plans/14-test-tiers.md, ADR 0098.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob, relative, resolve } from "node:path";
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

it("runs the tier in the merge check for a change to the commit hooks, the hook scripts and tests, or any product tooling that has integration specs, and for no agent configuration or docs", () => {
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
    "tools/harness/src/flow/report.ts",
    "tools/harness/src/judge/verdict.ts",
    "tools/harness/package.json",
    "tools/kore/src/runtime/runner.ts",
    ".github/workflows/integration.yml",
  ]) {
    expect(triggers.test(path), path).toBe(true);
  }
  // Agent configuration and docs run no tier in the merge check; the nightly
  // integration job covers them after merge.
  for (const path of [
    ".claude/settings.json",
    ".claude/agents/reviewer.md",
    "skills/handoff/SKILL.md",
    ".codex/config.toml",
    "docs/index.md",
    "tools/other/src/x.ts",
  ]) {
    expect(triggers.test(path), path).toBe(false);
  }
});

it("runs the tier on every manual dispatch without diffing, and keeps the pull request path filtered by path", () => {
  const workflow = readFileSync(
    join(repo, ".github/workflows/integration.yml"),
    "utf8",
  );

  expect(workflow).toMatch(/^on:\n {2}pull_request:\n {2}workflow_dispatch:$/m);
  expect(workflow).toMatch(
    /^ {10}EVENT_NAME: \$\{\{ github\.event_name \}\}$/m,
  );
  // A dispatch has no pull request SHAs, so it must not reach the diff.
  const run = /^ {8}run: \|\n((?: {10}.*\n)+)/m.exec(workflow)?.[1] ?? "";
  const dispatch = run.indexOf('"$EVENT_NAME" = workflow_dispatch');
  expect(dispatch).toBeGreaterThanOrEqual(0);
  expect(dispatch).toBeLessThan(run.indexOf("git diff"));
  expect(run).toMatch(/workflow_dispatch \]; then\n\s+echo "hooks=true"/);
  // The integration job still needs the changes job, so the check is always reported.
  expect(workflow).toMatch(
    /needs: changes\n\s+if: needs\.changes\.outputs\.hooks == 'true'/,
  );
});

// The unit run starts no process and reads no built bundle (ADR 0098). A spec that
// imports a real child_process, or reads skills/bin/harness.mjs, belongs in integration/.
const unitSpecs = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return unitSpecs(path);
    }
    return entry.name.endsWith(".spec.ts") ? [path] : [];
  });

it("starts no process and reads no built bundle in any harness unit spec", () => {
  const offenders = [
    ...unitSpecs(join(harness, "src")),
    ...unitSpecs(join(harness, "tests")),
  ].flatMap((file) => {
    const text = readFileSync(file, "utf8");
    const found: string[] = [];
    if (
      /^import(?! type)[^;]*from ["'](?:node:)?child_process["']/m.test(text) &&
      !/vi\.mock\(["'](?:node:)?child_process["']/.test(text)
    ) {
      found.push("imports child_process unmocked");
    }
    if (/readFile(?:Sync)?\([^)]*harness\.mjs/.test(text)) {
      found.push("reads the built harness bundle");
    }
    return found.map((reason) => `${relative(harness, file)}: ${reason}`);
  });

  expect(offenders).toEqual([]);
});
