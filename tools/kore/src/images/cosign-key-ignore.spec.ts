import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";

const run = promisify(execFile);

/** No GIT_* variable: under a git hook GIT_DIR names the real repository, which git would read (#368). */
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);

test("cosign's default key pair files are never picked up by git in any directory", async () => {
  const { root } = await loadRepository("local");
  for (const path of [
    "cosign.pub",
    "cosign.key",
    "tools/kore/cosign.pub",
    "tools/kore/cosign.key",
  ]) {
    const { stdout } = await run("git", ["check-ignore", "--no-index", path], {
      cwd: root,
      env: gitEnv,
    }).catch(() => ({ stdout: "" }));
    assert.equal(stdout.trim(), path, `${path} must be gitignored`);
  }
});
