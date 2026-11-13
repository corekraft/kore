// Runs a command under a host-wide test semaphore, so commit hooks in many
// worktrees share the cores instead of multiplying vitest workers beside a live
// cluster. Usage: node test-lock.mjs <command> [args...]
// The host admits as many runs as test-slots.mjs sizes from the cores and the
// current load average (KORE_TEST_SLOTS fixes it); the rest wait and say so.
// Slot files (test-slot-<n>.lock) live under the main checkout's .kore/state
// (shared by every worktree). A holder whose pid is gone is broken, never
// waited on.
//   KORE_TEST_LOCK_DIR      lock directory (default: <main checkout>/.kore/state)
//   KORE_TEST_SLOTS         fixed slot count (default: sized from cores and load)
//   KORE_TEST_LOCK_WAIT_MS  longest wait (default 15 minutes)
//   KORE_TEST_LOCK_POLL_MS  poll interval (default 1000)
//   KORE_HOST_ROOT          host directory holding .kore/locks (default: home)
// A live run holds the exclusive host lease (.kore/locks/host-lease.lock). A
// test run beside it is audited, to stderr and host-lease-audit.jsonl in the
// lock directory, and still runs: enforcing the wait needs the owner's OK.
// Docs: docs/guides/contributor.md (Commit hooks)

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { slotCount } from "./test-slots.mjs";

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

const slotFile = (directory, index) =>
  join(directory, `test-slot-${index}.lock`);

/** Takes the first free slot below the current size; breaks a slot whose holder is gone. */
function tryTake(directory, size) {
  const owners = [];
  for (let index = 0; index < size; index += 1) {
    const lock = slotFile(directory, index);
    try {
      writeFileSync(
        lock,
        JSON.stringify({ pid: process.pid, cwd: process.cwd() }),
        { flag: "wx" },
      );
      return { lock };
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
    const owner = holder(lock);
    if (owner === undefined || !alive(owner.pid)) {
      rmSync(lock, { force: true });
      return tryTake(directory, size);
    }
    owners.push({ ...owner, lock });
  }
  return { owners };
}

async function acquire(directory) {
  const waitMs = Number(process.env.KORE_TEST_LOCK_WAIT_MS ?? DEFAULT_WAIT_MS);
  const pollMs = Number(process.env.KORE_TEST_LOCK_POLL_MS ?? 1000);
  const deadline = Date.now() + waitMs;
  let announced;
  for (;;) {
    const size = slotCount();
    const taken = tryTake(directory, size);
    if (taken.lock !== undefined) {
      return taken.lock;
    }
    const pids = taken.owners.map((owner) => owner.pid).join(", ");
    if (announced !== pids) {
      announced = pids;
      console.error(
        `waiting for a test slot: ${size} in use by pid ${pids} (${taken.owners.map((owner) => owner.cwd).join(", ")}); the host admits ${size} at a time for its cores and load`,
      );
    }
    if (Date.now() >= deadline) {
      console.error(
        `test slots still held by pid ${pids} after ${Math.round(waitMs / 1000)}s; wait for them to finish, or if one is hung, kill it or remove ${taken.owners.map((owner) => owner.lock).join(" ")} and rerun`,
      );
      process.exit(1);
    }
    await sleep(pollMs);
  }
}

/** The host directory of `.kore/locks`; an empty value is unset, and a relative one is not usable. */
function hostRoot() {
  const given = [process.env.KORE_HOST_ROOT, process.env.HOME].find(
    (value) => value !== undefined && value !== "",
  );
  const root = given ?? homedir();
  if (!isAbsolute(root)) {
    throw new Error(
      `the host root "${root}" is not absolute; set KORE_HOST_ROOT to an absolute directory`,
    );
  }
  return root;
}

/**
 * Reports, without waiting, a test run that starts while a live run holds the
 * host lease. Audit only: nothing here may stop the run, so every failure is
 * reported and swallowed.
 */
function auditHostLease(directory) {
  let lease;
  try {
    lease = holder(join(hostRoot(), ".kore", "locks", "host-lease.lock"));
  } catch (error) {
    console.error(`audit: host lease not checked: ${error.message}`);
    return;
  }
  if (lease === undefined || !alive(lease.pid)) {
    return;
  }
  console.error(
    `audit: host lease held by pid ${lease.pid}; this test run would wait for it once enforcement is on (not waiting now)`,
  );
  try {
    appendFileSync(
      join(directory, "host-lease-audit.jsonl"),
      `${JSON.stringify({
        at: new Date().toISOString(),
        holder: lease.pid,
        cwd: process.cwd(),
        command: process.argv.slice(2).join(" "),
      })}\n`,
    );
  } catch (error) {
    console.error(`audit: could not write the audit log: ${error.message}`);
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === undefined) {
  console.error("usage: node test-lock.mjs <command> [args...]");
  process.exit(2);
}

const directory = lockDirectory();
mkdirSync(directory, { recursive: true });
auditHostLease(directory);
const lock = await acquire(directory);

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
