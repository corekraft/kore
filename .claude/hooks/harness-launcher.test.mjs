import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
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

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const launcher = join(root, ".claude", "hooks", "harness.sh");

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "harness-launcher-"));
  const project = join(dir, "worktree");
  mkdirSync(join(project, "skills", "bin"), { recursive: true });
  return {
    dir,
    project,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function run(project, args, env = {}) {
  const clean = { ...process.env };
  delete clean.KORE_HARNESS_BUNDLE;
  return spawnSync("sh", [launcher, ...args], {
    cwd: project,
    encoding: "utf8",
    env: { ...clean, CLAUDE_PROJECT_DIR: project, ...env },
  });
}

const echoBundle = "console.log(JSON.stringify(process.argv.slice(2)));\n";

test("the guard hook is blocked (exit 2) with a build hint when no bundle is present", () => {
  const s = sandbox();
  try {
    const result = run(s.project, ["hook", "guard"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /npm ci --prefix tools\/harness/);
    assert.match(result.stderr, /mise run harness-build/);
  } finally {
    s.cleanup();
  }
});

test("a non-guard hook reports the missing bundle without blocking the session", () => {
  const s = sandbox();
  try {
    for (const args of [
      ["hook", "feedback", "stop"],
      ["hook", "context"],
    ]) {
      const result = run(s.project, args);
      assert.equal(result.status, 1, args.join(" "));
      assert.match(result.stderr, /mise run harness-build/);
    }
  } finally {
    s.cleanup();
  }
});

test("the worktree bundle runs with every argument passed through", () => {
  const s = sandbox();
  try {
    writeFileSync(join(s.project, "skills", "bin", "harness.mjs"), echoBundle);
    const result = run(s.project, ["hook", "feedback", "post-edit"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [
      "hook",
      "feedback",
      "post-edit",
    ]);
  } finally {
    s.cleanup();
  }
});

test("KORE_HARNESS_BUNDLE wins over the worktree bundle", () => {
  const s = sandbox();
  try {
    writeFileSync(
      join(s.project, "skills", "bin", "harness.mjs"),
      "process.exit(9);\n",
    );
    const outside = join(s.dir, "readonly.mjs");
    writeFileSync(outside, echoBundle);
    chmodSync(outside, 0o444);
    const result = run(s.project, ["hook", "guard"], {
      KORE_HARNESS_BUNDLE: outside,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), ["hook", "guard"]);
  } finally {
    s.cleanup();
  }
});

test("a KORE_HARNESS_BUNDLE that points nowhere fails closed and never falls back to the worktree", () => {
  const s = sandbox();
  try {
    writeFileSync(join(s.project, "skills", "bin", "harness.mjs"), echoBundle);
    const result = run(s.project, ["hook", "guard"], {
      KORE_HARNESS_BUNDLE: join(s.dir, "missing.mjs"),
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /KORE_HARNESS_BUNDLE/);
    assert.equal(result.stdout, "");
  } finally {
    s.cleanup();
  }
});

test("settings route every hook through the launcher, not the bundle path", () => {
  const settings = readFileSync(join(root, ".claude", "settings.json"), "utf8");
  assert.doesNotMatch(settings, /skills\/bin\/harness\.mjs/);
  assert.match(settings, /\.claude\/hooks\/harness\.sh\\" hook guard/);
});
