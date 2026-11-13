import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { cleanGitEnv } from "../src/testing/git-env.js";

// The knowledge check as the host, mise and CI run it: the built bundle as a real process.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const bundle = resolve(repo, "skills/bin/harness.mjs");

// A project directory in the environment would point the check at another tree than the one under test.
const { CLAUDE_PROJECT_DIR: _project, ...inherited } = cleanGitEnv();

it("cli: runs against the repository and exits 0 in warn mode", () => {
  const warn = spawnSync("node", [bundle, "hook", "kb-check"], {
    cwd: repo,
    encoding: "utf8",
    env: inherited,
  });
  assert.equal(warn.status, 0, warn.stderr);
  assert.match(
    warn.stdout,
    /^kb-check: (clean|\d+ findings?|\d+ stale documents?)/m,
  );
});
