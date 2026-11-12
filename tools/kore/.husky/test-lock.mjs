// Runs a command under a host-wide test lock, so commit hooks in many worktrees
// queue their unit tests instead of multiplying vitest workers beside a live
// cluster. Usage: node test-lock.mjs <command> [args...]
// The lock file lives under the main checkout's .kore/state (shared by every
// worktree). A holder whose pid is gone is broken, never waited on.
//   KORE_TEST_LOCK_DIR      lock directory (default: <main checkout>/.kore/state)
//   KORE_TEST_LOCK_WAIT_MS  longest wait (default 15 minutes)
//   KORE_TEST_LOCK_POLL_MS  poll interval (default 1000)
// Docs: docs/guides/contributor.md (Commit hooks)

import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const DEFAULT_WAIT_MS = 15 * 60 * 1000;

function lockDirectory() {
  if (process.env.KORE_TEST_LOCK_DIR) {
    return process.env.KORE_TEST_LOCK_DIR;
  }
  const common = spawnSync("git", ["rev-parse", "--git-common-dir"], {
    encoding: "utf8",
  });
  const gitDir = common.status === 0 ? common.stdout.trim() : "";
  const mainCheckout = gitDir
    ? dirname(isAbsolute(gitDir) ? gitDir : resolve(gitDir))
    : process.cwd();
  return join(mainCheckout, ".kore", "state");
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function holder(lock) {
  try {
    const owner = JSON.parse(readFileSync(lock, "utf8"));
    return Number.isInteger(owner.pid) ? owner : undefined;
  } catch {
    return undefined;
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function acquire(lock) {
  const waitMs = Number(process.env.KORE_TEST_LOCK_WAIT_MS ?? DEFAULT_WAIT_MS);
  const pollMs = Number(process.env.KORE_TEST_LOCK_POLL_MS ?? 1000);
  const deadline = Date.now() + waitMs;
  let announced;
  for (;;) {
    try {
      writeFileSync(
        lock,
        JSON.stringify({ pid: process.pid, cwd: process.cwd() }),
        {
          flag: "wx",
        },
      );
      return;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
    const owner = holder(lock);
    if (owner === undefined || !alive(owner.pid)) {
      rmSync(lock, { force: true });
      continue;
    }
    if (announced !== owner.pid) {
      announced = owner.pid;
      console.error(
        `waiting for another worktree's tests (pid ${owner.pid}) in ${owner.cwd}`,
      );
    }
    if (Date.now() >= deadline) {
      console.error(
        `test lock still held by pid ${owner.pid} after ${Math.round(waitMs / 1000)}s; wait for it to finish, or if that process is hung, kill it or remove ${lock} and rerun`,
      );
      process.exit(1);
    }
    await sleep(pollMs);
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === undefined) {
  console.error("usage: node test-lock.mjs <command> [args...]");
  process.exit(2);
}

const directory = lockDirectory();
mkdirSync(directory, { recursive: true });
const lock = join(directory, "test.lock");
await acquire(lock);

const release = () => {
  try {
    if (holder(lock)?.pid === process.pid) {
      unlinkSync(lock);
    }
  } catch {
    // already gone
  }
};
process.on("exit", release);

const child = spawn(command, args, { stdio: "inherit" });
for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.on(signal, () => {
    child.kill(signal);
    release();
    process.exit(code);
  });
}
child.on("error", (error) => {
  console.error(`could not run ${command}: ${error.message}`);
  process.exit(127);
});
child.on("close", (status, signal) => {
  process.exit(status ?? (signal ? 128 : 1));
});
