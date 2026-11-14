// The commit hook's test runs start without any GIT_* variable (#368). A commit
// made in a linked worktree exports the real repository's git variables, and a
// fixture's git inherits them and writes that repository's config. This runs the
// real test-lock.mjs with those variables set, in a throwaway repository and a
// temporary lock directory, and reads what its child sees.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanGitEnv } from "../src/testing/git-env.js";

const TEST_LOCK = fileURLToPath(
  new URL("../../kore/.husky/test-lock.mjs", import.meta.url),
);
/** What the child prints: its GIT_* keys and its PATH. */
const CHILD = `process.stdout.write(JSON.stringify({ keys: Object.keys(process.env).filter((k) => k.startsWith("GIT_")), path: process.env.PATH ?? null }));`;

let repo = "";
let scratch = "";

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "kore-test-lock-env-"));
  repo = join(scratch, "repo");
  execFileSync("git", ["init", "-q", repo], { env: cleanGitEnv() });
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** The variables a commit hook exports for the real repository, pointed at the throwaway one. */
function hookVariables(): Record<string, string> {
  const git = join(repo, ".git");
  return {
    GIT_DIR: git,
    GIT_COMMON_DIR: git,
    GIT_INDEX_FILE: join(git, "index"),
    GIT_WORK_TREE: repo,
  };
}

describe("test-lock.mjs child environment", () => {
  it("control: a child started with the hook's variables sees them", () => {
    const run = spawnSync(process.execPath, ["-e", CHILD], {
      encoding: "utf8",
      env: { ...cleanGitEnv(), ...hookVariables() },
    });
    expect(JSON.parse(run.stdout).keys.sort()).toEqual(
      Object.keys(hookVariables()).sort(),
    );
  });

  it("starts the test run with no GIT_* variable and keeps PATH", () => {
    const run = spawnSync(
      process.execPath,
      [TEST_LOCK, process.execPath, "-e", CHILD],
      {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...cleanGitEnv(),
          ...hookVariables(),
          KORE_TEST_LOCK_DIR: join(scratch, "lock"),
          KORE_HOST_ROOT: join(scratch, "host"),
          KORE_TEST_LOCK_WAIT_MS: "5000",
        },
      },
    );
    expect(run.status, run.stderr).toBe(0);
    const child = JSON.parse(run.stdout) as { keys: string[]; path: string };
    expect(child.keys).toEqual([]);
    expect(child.path).toBe(process.env["PATH"] ?? null);
  });
});
