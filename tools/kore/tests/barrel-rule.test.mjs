import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

// Docs: infra/plans/14-test-tiers.md (Step 1, barrel rule for the kore package)
// Starts oxlint, so it is an integration test. It lives outside src/, so the
// unit run, tsc and the commit hook never see it; run it with
// `npm run test:barrel-rule`.

const packageRoot = process.cwd();
const configPath = join(packageRoot, ".oxlintrc.json");
const oxlint = join(packageRoot, "node_modules", ".bin", "oxlint");
const config = JSON.parse(readFileSync(configPath, "utf8"));

// The barrel-rule pattern for a domain has exactly two groups: `**/<domain>/**`
// and its `!**/<domain>/index.js` exception.
function domainOf(pattern) {
  if (pattern.group?.length !== 2) {
    return undefined;
  }
  const match = /^\*\*\/([a-z]+)\/\*\*$/.exec(pattern.group[0]);
  return match?.[1];
}

function rulePatterns(rules) {
  return rules["no-restricted-imports"][1].patterns;
}

function domainsIn(patterns) {
  return patterns.map(domainOf).filter((domain) => domain !== undefined);
}

// Production code (the base rule) bans the testing domain outright. Specs and
// fixtures (the last override that names them) get every domain, testing's
// barrel included. Overrides replace the rule, so the lists are repeated.
const baseRule = rulePatterns(config.rules);
const specRule = config.overrides
  .filter((override) => override.files.includes("**/*fixtures.ts"))
  .map((override) => override.rules?.["no-restricted-imports"])
  .find((rule) => rule !== undefined);
const specPatterns = specRule?.[1].patterns ?? [];

const barrelMessage = (domain) =>
  `import from the ${domain} barrel (${domain}/index.js), not one of its files`;
const productionMessage =
  "production code must not import the testing domain; only specs and fixtures may";

// Lints `files` (paths under a scratch `src/`) with the package's own oxlint
// config and returns the restricted-import violations, sorted by file and line.
function lint(files) {
  const scratch = mkdtempSync(join(tmpdir(), "kore-barrel-rule-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      const file = join(scratch, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, source);
    }
    const run = spawnSync(oxlint, ["-c", configPath, "--format=json", "src"], {
      cwd: scratch,
      encoding: "utf8",
    });
    const report = JSON.parse(run.stdout);
    // oxlint 1.92 reports a named import twice, once per copy of the same
    // diagnostic. Each distinct violation is compared once.
    const distinct = new Map();
    for (const d of report.diagnostics) {
      if (d.code === "eslint(no-restricted-imports)") {
        const line = d.labels[0]?.span.line ?? 0;
        distinct.set(`${d.filename}:${line}:${d.help}`, {
          file: d.filename,
          line,
          help: d.help,
        });
      }
    }
    const violations = [...distinct.values()].sort(
      (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
    );
    return { status: run.status, violations };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const srcDomains = readdirSync(join(packageRoot, "src"), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

test("every directory under src is a configured domain, and every domain is a directory", () => {
  assert.deepEqual(domainsIn(specPatterns).sort(), srcDomains);
  assert.deepEqual(
    domainsIn(baseRule).sort(),
    srcDomains.filter((domain) => domain !== "testing"),
  );
});

test("production code bans the testing domain, and only specs and fixtures get its barrel", () => {
  assert.deepEqual(
    baseRule
      .filter((pattern) => domainOf(pattern) === undefined)
      .map((pattern) => pattern.message),
    [productionMessage],
  );
  assert.deepEqual(
    specPatterns.filter((pattern) => domainOf(pattern) === undefined),
    [],
  );
});

test("a deep import of another domain's file fails lint and names its barrel", () => {
  const result = lint({
    "src/cli/deep.ts":
      'import { appUp } from "../app/up.js";\nexport { appUp };\n',
  });

  assert.equal(result.status, 1);
  assert.deepEqual(result.violations, [
    { file: "src/cli/deep.ts", line: 1, help: barrelMessage("app") },
  ]);
});

test("a deep import of a nested file in another domain fails lint", () => {
  const result = lint({
    "src/ops/nested.ts":
      'import { fixture } from "../platform/fixtures/nested.js";\nexport { fixture };\n',
  });

  assert.deepEqual(result.violations, [
    { file: "src/ops/nested.ts", line: 1, help: barrelMessage("platform") },
  ]);
});

test("a deep dynamic import of another domain's file fails lint", () => {
  const result = lint({
    "src/cli/load.ts": 'export const load = () => import("../app/up.js");\n',
  });

  assert.equal(result.status, 1);
  assert.deepEqual(result.violations, [
    { file: "src/cli/load.ts", line: 1, help: barrelMessage("app") },
  ]);
});

test("a deep import of every domain fails lint, the testing domain with the production ban", () => {
  const others = srcDomains.filter((domain) => domain !== "ops");
  const source = others
    .map((domain) => `import "../${domain}/nested/deep.js";`)
    .join("\n");
  const result = lint({ "src/ops/every.ts": `${source}\n` });

  // Production code never imports testing, so its message says so rather
  // than naming the testing barrel.
  assert.deepEqual(
    result.violations,
    others.map((domain, index) => ({
      file: "src/ops/every.ts",
      line: index + 1,
      help: domain === "testing" ? productionMessage : barrelMessage(domain),
    })),
  );
});

test("a barrel import from another domain passes lint", () => {
  const result = lint({
    "src/cli/barrel.ts":
      'import { appUp } from "../app/index.js";\nexport { appUp };\n',
  });

  assert.equal(result.status, 0);
  assert.deepEqual(result.violations, []);
});

test("an import of a file in the same domain passes lint", () => {
  const result = lint({
    "src/app/up.ts":
      'import { appStatus } from "./app.js";\nexport { appStatus };\n',
  });

  assert.equal(result.status, 0);
  assert.deepEqual(result.violations, []);
});

test("a standard library module or a package import passes lint", () => {
  const result = lint({
    "src/cli/packages.ts": [
      'import { readFileSync } from "node:fs";',
      'import { describe } from "vitest";',
      'import { defineConfig } from "vitest/config";',
      "export { defineConfig, describe, readFileSync };",
      "",
    ].join("\n"),
  });

  assert.equal(result.status, 0);
  assert.deepEqual(result.violations, []);
});

test("production code cannot import the testing domain, its barrel included", () => {
  const result = lint({
    "src/cli/prod.ts":
      'import { testHome } from "../testing/index.js";\nexport { testHome };\n',
  });

  assert.equal(result.status, 1);
  assert.deepEqual(result.violations, [
    { file: "src/cli/prod.ts", line: 1, help: productionMessage },
  ]);
});

test("specs and fixtures may import the testing barrel", () => {
  const result = lint({
    "src/cli/a.spec.ts":
      'import { testHome } from "../testing/index.js";\nexport { testHome };\n',
    "src/platform/resilience-fixtures.ts":
      'import { testHome } from "../testing/index.js";\nexport { testHome };\n',
  });

  assert.equal(result.status, 0);
  assert.deepEqual(result.violations, []);
});

test("a spec still cannot import a file inside the testing domain", () => {
  const result = lint({
    "src/cli/b.spec.ts":
      'import { appUp } from "../testing/app-fixtures.js";\nexport { appUp };\n',
  });

  assert.deepEqual(result.violations, [
    { file: "src/cli/b.spec.ts", line: 1, help: barrelMessage("testing") },
  ]);
});

test("production code cannot re-export the testing domain", () => {
  const result = lint({
    "src/cli/reexport.ts": 'export { testHome } from "../testing/index.js";\n',
  });

  assert.equal(result.status, 1);
  assert.deepEqual(result.violations, [
    { file: "src/cli/reexport.ts", line: 1, help: productionMessage },
  ]);
});

test("production code cannot load the testing domain dynamically", () => {
  const result = lint({
    "src/cli/lazy.ts":
      'export const load = () => import("../testing/index.js");\n',
  });

  assert.equal(result.status, 1);
  assert.deepEqual(result.violations, [
    { file: "src/cli/lazy.ts", line: 1, help: productionMessage },
  ]);
});

// ADR 0098: the testing barrel re-exports fakes that reach into domain
// internals, so its one file (and no other) may deep-import a domain. The
// override in .oxlintrc.json cannot carry this comment: that file stays plain
// JSON, which this test parses.
test("the testing barrel may deep-import another domain's internals", () => {
  const result = lint({
    "src/testing/index.ts":
      'import { manifestImages } from "../config/manifest-images.js";\nexport { manifestImages };\n',
  });

  assert.equal(result.status, 0);
  assert.deepEqual(result.violations, []);
});

test("a fixture beside the testing barrel still fails lint on a deep import", () => {
  const result = lint({
    "src/testing/app-fixtures.ts":
      'import { manifestImages } from "../config/manifest-images.js";\nexport { manifestImages };\n',
  });

  assert.deepEqual(result.violations, [
    {
      file: "src/testing/app-fixtures.ts",
      line: 1,
      help: barrelMessage("config"),
    },
  ]);
});

test("the testing barrel override names only its own file and turns off only no-restricted-imports", () => {
  const overrides = config.overrides.filter((override) =>
    override.files.some((glob) => glob.includes("testing")),
  );

  assert.deepEqual(overrides, [
    {
      files: ["**/src/testing/index.ts"],
      rules: { "no-restricted-imports": "off" },
    },
  ]);
});
