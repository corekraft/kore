// The integration tier is its own vitest project in each package. The default,
// unit, hook and commit-gate runs select only the unit and bundle projects, so
// they never run an integration spec. One explicit command runs the tier.
// Docs: infra/plans/14-test-tiers.md, docs/decisions/0098-unit-tests-mock-everything-outside-the-unit-and-integration-tests-gate-only-a-release.md

import { readFileSync } from "node:fs";
import { dirname, join, matchesGlob, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const harness = resolve(here, "..");
const kore = resolve(here, "../../kore");
const repo = resolve(here, "../../..");

// The path a harness vitest project uses for the hook test that moves into the tier.
const movedFromHarness = "../../.claude/hooks/sast-staged.integration.test.mjs";

type Project = {
  test: { name: string; include?: string[]; exclude?: string[] };
};
type Config = { test: { projects: Project[] } };

const readScripts = (dir: string) =>
  (
    JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts;

const project = (config: Config, name: string) =>
  config.test.projects.find((p) => p.test.name === name);

const matchesAny = (patterns: string[] | undefined, file: string) =>
  (patterns ?? []).some((pattern) => matchesGlob(file, pattern));

it("gives the harness an integration project that runs the moved hook test, which the unit project excludes", async () => {
  const { default: config } = (await import(
    join(harness, "vitest.config.ts")
  )) as { default: Config };
  const integration = project(config, "integration");
  const unit = project(config, "unit");

  expect(integration).toBeDefined();
  expect(matchesAny(integration?.test.include, movedFromHarness)).toBe(true);
  expect(matchesAny(unit?.test.exclude, movedFromHarness)).toBe(true);
  expect(matchesAny(unit?.test.include, movedFromHarness)).toBe(true);
});

it("gives kore an integration project, and its unit project excludes integration specs", async () => {
  const { default: config } = (await import(
    join(kore, "vitest.config.ts")
  )) as {
    default: Config;
  };
  const integration = project(config, "integration");
  const unit = project(config, "unit");

  expect(integration).toBeDefined();
  expect(
    matchesAny(integration?.test.include, "src/a.integration.spec.ts"),
  ).toBe(true);
  expect(matchesAny(unit?.test.exclude, "src/a.integration.spec.ts")).toBe(
    true,
  );
  expect(matchesAny(unit?.test.include, "src/a.spec.ts")).toBe(true);
});

it("keeps the default, unit, hook and related runs on the unit and bundle projects", () => {
  const harnessScripts = readScripts(harness);
  const koreScripts = readScripts(kore);

  expect(harnessScripts.test).toBe(
    "vitest run --coverage --project unit --project bundle",
  );
  expect(harnessScripts["test:unit"]).toBe(
    "vitest run --project unit --project bundle",
  );
  expect(harnessScripts["test:hooks"]).toBe(
    "vitest run --project unit --project bundle .claude/",
  );
  expect(harnessScripts["test:related"]).toBe(
    "vitest related --run --passWithNoTests --maxWorkers=2 --project unit --project bundle",
  );
  expect(koreScripts.test).toBe(
    "npm run build --silent && vitest run --coverage --project unit",
  );
  expect(koreScripts["test:unit"]).toBe("vitest run --project unit");
  expect(koreScripts["test:related"]).toBe(
    "vitest related --run --passWithNoTests --maxWorkers=2 --project unit",
  );
});

it("runs only the integration tier of each package from one local command", () => {
  const mise = readFileSync(join(repo, ".mise.toml"), "utf8");

  expect(readScripts(harness)["test:integration"]).toBe(
    "vitest run --project integration",
  );
  expect(readScripts(kore)["test:integration"]).toBe(
    "vitest run --project integration --passWithNoTests",
  );
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
