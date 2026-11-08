import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";

const run = promisify(execFile);

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
    }).catch(() => ({ stdout: "" }));
    assert.equal(stdout.trim(), path, `${path} must be gitignored`);
  }
});
