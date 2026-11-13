// Runs a command under a host-wide test semaphore, so commit hooks in many
// worktrees share the cores instead of multiplying vitest workers beside a live
// cluster. Usage: node test-lock.mjs <command> [args...]
// The host admits as many runs as test-slots.mjs sizes from the cores and the
// current load average (KORE_TEST_SLOTS fixes it); the rest wait and say so.
// Slot files (test-slot-<n>.lock) live under the main checkout's .kore/state
// (shared by every worktree). A holder whose pid is gone is broken, never
// waited on: its pid is gone, or it predates the host's boot (pid reuse). A slot
// is claimed with complete content (written aside, then linked into place), and
// one that cannot be read is a claim in progress, broken only after a few seconds.
// The same run also skips a step whose staged tree and command already passed,
// and records a pass: only after this run's command exits 0 with no unstaged
// change, under <lock directory>/test-pass/<tree>/<step>. Nothing else writes it.
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
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, uptime } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { slotCount } from "./test-slots.mjs";

const DEFAULT_WAIT_MS = 15 * 60 * 1000;
// An unreadable slot is younger than this while its owner is still writing it.
const UNREADABLE_GRACE_MS = 5000;
// Clock and uptime readings differ by a little; only a clear gap proves a reboot.
const BOOT_TOLERANCE_MS = 60_000;

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

/** Whether the slot's holder is gone: dead pid, a claim from before this boot, or an unreadable file left for good. */
function stale(lock, owner) {
  if (owner === undefined) {
    try {
      return Date.now() - statSync(lock).mtimeMs > UNREADABLE_GRACE_MS;
    } catch {
      return true;
    }
  }
  const bootedAt = Date.now() - uptime() * 1000;
  return (
    !alive(owner.pid) ||
    Date.parse(owner.acquiredAt) < bootedAt - BOOT_TOLERANCE_MS
  );
}

/** Claims the slot with complete content: written aside, then linked into place (EEXIST when taken). */
function claim(lock) {
  const aside = `${lock}.${process.pid}.tmp`;
  writeFileSync(
    aside,
    JSON.stringify({
      pid: process.pid,
      cwd: process.cwd(),
      acquiredAt: new Date().toISOString(),
    }),
  );
  try {
    linkSync(aside, lock);
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
    return false;
  } finally {
    rmSync(aside, { force: true });
  }
}

/**
 * Removes a stale slot atomically: rename it away, then check what was really
 * moved. A live slot that replaced the stale one in between is put back.
 */
function breakSlot(lock) {
  const moved = `${lock}.broken.${process.pid}`;
  try {
    renameSync(lock, moved);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (!stale(moved, holder(moved))) {
    try {
      linkSync(moved, lock);
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }
  rmSync(moved, { force: true });
}

/** Takes the first free slot below the current size; breaks a slot whose holder is gone. */
function tryTake(directory, size) {
  const owners = [];
  for (let index = 0; index < size; index += 1) {
    const lock = slotFile(directory, index);
    for (;;) {
      if (claim(lock)) {
        return { lock };
      }
      const owner = holder(lock);
      if (!existsSync(lock)) {
        continue;
      }
      if (stale(lock, owner)) {
        breakSlot(lock);
        continue;
      }
      owners.push({
        pid: owner?.pid ?? "unknown",
        cwd: owner?.cwd ?? "?",
        lock,
      });
      break;
    }
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

/** The staged tree, or undefined when git cannot say (never a reason to skip or fail). */
function stagedTree() {
  const tree = spawnSync("git", ["write-tree"], { encoding: "utf8" });
  const hash = tree.stdout?.trim() ?? "";
  return tree.status === 0 && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(hash)
    ? hash
    : undefined;
}

/** Where this step's pass is recorded: one file per staged tree and exact command. */
function passRecord(directory, tree, command, args) {
  const prefix = spawnSync("git", ["rev-parse", "--show-prefix"], {
    encoding: "utf8",
  }).stdout?.trim();
  const step = createHash("sha256")
    .update(JSON.stringify([prefix ?? "", command, ...args]))
    .digest("hex");
  return join(directory, "test-pass", tree, step);
}

/** Records a pass only when no tracked file differs from the index, so the run was of the staged tree. */
function recordPass(file, tree) {
  const unstaged = spawnSync("git", ["diff", "--quiet"]).status !== 0;
  if (unstaged || stagedTree() !== tree) {
    return;
  }
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify({ tree, at: new Date().toISOString() })}\n`,
    );
  } catch (error) {
    console.error(`could not record the pass: ${error.message}`);
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === undefined) {
  console.error("usage: node test-lock.mjs <command> [args...]");
  process.exit(2);
}

const directory = lockDirectory();
mkdirSync(directory, { recursive: true });
const tree = stagedTree();
const record =
  tree === undefined ? undefined : passRecord(directory, tree, command, args);
if (record !== undefined && existsSync(record)) {
  console.error(
    `tests already passed at tree ${tree}: skipping ${[command, ...args].join(" ")}`,
  );
  process.exit(0);
}
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
  if (status === 0 && record !== undefined) {
    recordPass(record, tree);
  }
  process.exit(status ?? (signal ? 128 : 1));
});
