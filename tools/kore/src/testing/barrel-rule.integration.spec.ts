import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

// Docs: infra/plans/14-test-tiers.md (Step 1, barrel rule for the kore package)
// An integration test: it starts oxlint, so it runs only through
// `npm run test:integration:barrel-rule`, never in the unit run or at commit.

// Keep in step with the restricted-import patterns in .oxlintrc.json.
const domains = [
  "app",
  "cli",
  "cluster",
  "config",
  "diagnostics",
  "images",
  "local",
  "ops",
  "platform",
  "runtime",
  "security",
  "testing",
];

interface Violation {
  file: string;
  line: number;
  help: string;
}

interface LintResult {
  status: number | null;
  violations: Violation[];
}

interface OxlintReport {
  diagnostics: {
    code: string;
    help: string;
    filename: string;
    labels: { span: { line: number } }[];
  }[];
}

function barrelMessage(domain: string): string {
  return `import from the ${domain} barrel (${domain}/index.js), not one of its files`;
}

// Lints `files` (paths under a scratch `src/`) with the package's own oxlint
// config and returns the restricted-import violations, sorted by file and line.
function lint(files: Record<string, string>): LintResult {
  const packageRoot = process.cwd();
  const scratch = mkdtempSync(join(tmpdir(), "kore-barrel-rule-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      const file = join(scratch, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, source);
    }
    const run = spawnSync(
      join(packageRoot, "node_modules", ".bin", "oxlint"),
      ["-c", join(packageRoot, ".oxlintrc.json"), "--format=json", "src"],
      { cwd: scratch, encoding: "utf8" },
    );
    const report = JSON.parse(run.stdout) as OxlintReport;
    // oxlint 1.92 reports a named import twice, once per copy of the same
    // diagnostic. Each distinct violation is compared once.
    const distinct = new Map<string, Violation>();
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

test("a deep import of every domain fails lint, the testing domain included", () => {
  const others = domains.filter((domain) => domain !== "ops");
  const source = others
    .map((domain) => `import "../${domain}/nested/deep.js";`)
    .join("\n");
  const result = lint({ "src/ops/every.ts": `${source}\n` });

  assert.deepEqual(
    result.violations,
    others.map((domain, index) => ({
      file: "src/ops/every.ts",
      line: index + 1,
      help: barrelMessage(domain),
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
