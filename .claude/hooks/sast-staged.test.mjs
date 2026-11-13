// The pre-commit SAST step scans only the staged source files the `scan-sast`
// task would scan, so selection must mirror that task and skip everything else.
// Docs: AGENTS.md

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "./node-test-shim.mjs";

const helper = fileURLToPath(
  new URL("../../tools/kore/.husky/sast-staged.mjs", import.meta.url),
);
const mise = readFileSync(
  fileURLToPath(new URL("../../.mise.toml", import.meta.url)),
  "utf8",
);

// Runs the helper in a repository where `existing` files exist on disk.
function select(staged, existing = staged) {
  const root = mkdtempSync(join(tmpdir(), "sast-staged-"));
  try {
    for (const file of existing) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), "x\n");
    }
    const result = spawnSync("node", [helper], {
      cwd: root,
      input: staged.join("\n") + "\n",
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.split("\n").filter(Boolean);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("staged .ts, .mjs and .js source under the scanned roots is selected", () => {
  const files = [
    "tools/kore/src/a.ts",
    "tools/harness/src/b/c.ts",
    "apps/reference/src/d.js",
    ".claude/hooks/e.mjs",
  ];
  assert.deepEqual(select(files), files);
});

test("tests, other file types and unscanned paths are not selected", () => {
  assert.deepEqual(
    select([
      "tools/kore/src/a.spec.ts",
      "tools/kore/src/a.test.ts",
      ".claude/hooks/a.test.mjs",
      "tools/kore/src/a.json",
      "README.md",
      "tools/kore/lint-staged.config.js",
      "infra/policies/semgrep/kore-node.ts",
      "apps/reference/node_modules/x/index.js",
    ]),
    [],
  );
});

test("a staged deletion is not selected because semgrep cannot read it", () => {
  assert.deepEqual(
    select(
      ["tools/kore/src/a.ts", "tools/kore/src/gone.ts"],
      ["tools/kore/src/a.ts"],
    ),
    ["tools/kore/src/a.ts"],
  );
});

test("the selection scope matches the scan-sast task roots and excludes", () => {
  const task =
    mise.match(/\[tasks\.scan-sast\]\n(?:.*\n)*?run = "(.*)"/)?.[1] ?? "";
  const roots = task.split(" ").filter((w) => /^(tools|apps|\.claude)/.test(w));
  assert.deepEqual(roots, [
    "tools/kore/src",
    "tools/harness/src",
    "apps",
    ".claude",
  ]);
  for (const glob of ["*.spec.ts", "*.test.ts", "*.test.mjs", "node_modules"]) {
    assert.ok(
      task.includes(`--exclude '${glob}'`) ||
        task.includes(`--exclude ${glob}`),
      glob,
    );
  }
});
