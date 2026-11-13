// After a pull stops tracking the bundle, a git hook rebuilds it so hooks keep
// working with no manual step (ADR 0092).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "./node-test-shim.mjs";

const husky = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "tools",
  "kore",
  ".husky",
);

const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);

function script(path, body) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

// A throwaway repo with the real hook scripts, a fake mise that runs its
// arguments, and a fake npm that logs and writes the bundle on `run build`.
function repo({
  bundle = false,
  modules = false,
  failBuild = false,
  mise = true,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "bundle-hook-"));
  spawnSync("git", ["init", "-q"], { cwd: root, env: cleanEnv });
  mkdirSync(join(root, "tools/kore/.husky"), { recursive: true });
  mkdirSync(join(root, "tools/harness"), { recursive: true });
  mkdirSync(join(root, "skills/bin"), { recursive: true });
  for (const f of [
    "build-harness-bundle.sh",
    "pinned.sh",
    "post-merge",
    "post-checkout",
  ]) {
    copyFileSync(join(husky, f), join(root, "tools/kore/.husky", f));
    chmodSync(join(root, "tools/kore/.husky", f), 0o755);
  }
  writeFileSync(join(root, "tools/harness/package.json"), "{}");
  if (modules) mkdirSync(join(root, "tools/harness/node_modules"));
  if (bundle) writeFileSync(join(root, "skills/bin/harness.mjs"), "// old\n");
  const bin = join(root, "fakebin");
  const log = join(root, "calls.log");
  script(
    join(bin, "npm"),
    `echo "npm $* (in $(basename "$PWD"))" >> "${log}"
if [ "$1 $2" = "run build" ]; then
  ${failBuild ? "echo build broke >&2; exit 1" : `echo "// built" > "${root}/skills/bin/harness.mjs"`}
fi`,
  );
  if (mise)
    script(join(bin, "mise"), `shift; [ "$1" = -- ] && shift; exec "$@"`);
  const path = mise ? `${bin}:${process.env.PATH}` : `${bin}:/usr/bin:/bin`;
  return {
    root,
    log,
    run: (hook, ...args) =>
      spawnSync("sh", [join(root, "tools/kore/.husky", hook), ...args], {
        cwd: root,
        encoding: "utf8",
        env: { ...cleanEnv, PATH: path },
      }),
    calls: () => (existsSync(log) ? readFileSync(log, "utf8") : ""),
    bundle: () => join(root, "skills/bin/harness.mjs"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("post-merge builds a bundle the merge deleted, installing dependencies first", () => {
  const r = repo();
  try {
    const result = r.run("post-merge");
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      r.calls(),
      /npm ci --silent \(in harness\)\nnpm run build --silent \(in harness\)/,
    );
    assert.equal(readFileSync(r.bundle(), "utf8"), "// built\n");
  } finally {
    r.cleanup();
  }
});

test("post-merge rebuilds a present bundle so pulled harness changes take effect", () => {
  const r = repo({ bundle: true, modules: true });
  try {
    assert.equal(r.run("post-merge").status, 0);
    assert.equal(r.calls(), "npm run build --silent (in harness)\n");
    assert.equal(readFileSync(r.bundle(), "utf8"), "// built\n");
  } finally {
    r.cleanup();
  }
});

test("post-checkout builds a missing bundle on a branch checkout, as in a new worktree", () => {
  const r = repo({ modules: true });
  try {
    assert.equal(r.run("post-checkout", "0000", "1111", "1").status, 0);
    assert.equal(readFileSync(r.bundle(), "utf8"), "// built\n");
  } finally {
    r.cleanup();
  }
});

test("post-checkout leaves a present bundle and a file checkout alone", () => {
  const present = repo({ bundle: true, modules: true });
  const file = repo({ modules: true });
  try {
    present.run("post-checkout", "0000", "1111", "1");
    file.run("post-checkout", "0000", "1111", "0");
    assert.equal(present.calls(), "");
    assert.equal(file.calls(), "");
    assert.equal(readFileSync(present.bundle(), "utf8"), "// old\n");
  } finally {
    present.cleanup();
    file.cleanup();
  }
});

test("a failed build never fails the git operation and says how to fix it", () => {
  const r = repo({ modules: true, failBuild: true });
  try {
    const result = r.run("post-merge");
    assert.equal(result.status, 0);
    assert.match(result.stderr, /mise run harness-build/);
    assert.match(result.stderr, /terminal/);
  } finally {
    r.cleanup();
  }
});

test("without mise the hook warns and never fails the git operation", () => {
  const r = repo({ modules: true, mise: false });
  try {
    const result = r.run("post-merge");
    assert.equal(result.status, 0);
    assert.match(result.stderr, /mise/);
  } finally {
    r.cleanup();
  }
});
