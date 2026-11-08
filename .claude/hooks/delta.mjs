#!/usr/bin/env node
// UserPromptSubmit hook. Tells the agent what changed since its previous turn:
// new commits on main, plan items ticked or added, locks taken or released, and
// journal operations started, finished, or failed. Parallel Herdr sessions
// change all of these between turns. The first prompt of a session only writes
// the baseline snapshot; an unchanged repository prints nothing.
// Plan: infra/plans/6-agent-primitives.md#step-3-what-changed-between-turns
// Node standard library only; reads local files and git, never kore or kubectl.
//
// Contract: reads the UserPromptSubmit event as JSON on stdin and returns the
// delta as additionalContext. Fails open: any error exits 0 without output.

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  activePlans,
  lastOperation,
  listItems,
  readJournals,
  readPlans,
} from "./context.mjs";

const MAX_CHARS = 600;
const MAX_ITEM_CHARS = 60;
const MAX_SUBJECTS = 3;
const SNAPSHOT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const LOCKS_DIR = ".kore/locks";

/** Open and ticked state per plan item: {planName: {itemTitle: checked}}. */
function planItems(plans) {
  const result = {};
  for (const name of activePlans(plans)) {
    const items = {};
    for (const { text } of listItems(plans[name])) {
      const match = /^- \[( |x)\] (.*)$/.exec(text);
      if (!match) continue;
      const title = match[2].replaceAll("**", "").slice(0, MAX_ITEM_CHARS);
      items[title] = match[1] === "x";
    }
    result[name] = items;
  }
  return result;
}

/** The comparable state of the repository and platform files right now. */
export function snapshot(deps) {
  const journal = {};
  for (const [environment, entries] of Object.entries(deps.readJournals())) {
    const last = lastOperation(entries);
    if (!last) continue;
    journal[environment] = {
      op: last.op,
      command: last.command,
      outcome: last.outcome,
      ...(last.error ? { error: last.error } : {}),
    };
  }
  return {
    head: deps.head(),
    branch: deps.branch(),
    main: deps.main(),
    plans: planItems(deps.readPlans()),
    locks: [...deps.listLocks()].sort(),
    journal,
  };
}

function operationLine(environment, operation) {
  const command = `\`${operation.command}\``;
  if (operation.outcome === null) return `${environment}: ${command} started`;
  if (operation.outcome === "failed") {
    return `${environment}: ${command} failed${operation.error ? `: ${operation.error}` : ""}`;
  }
  return `${environment}: ${command} finished ${operation.outcome}`;
}

/** What differs between two snapshots, at most 600 characters; empty when nothing does. */
export function describeChanges(before, after, commitsBetween) {
  const lines = [];
  if (before.main !== after.main && after.main) {
    const subjects = before.main ? commitsBetween(before.main, after.main) : [];
    if (subjects.length === 0) {
      lines.push(`main moved to ${String(after.main).slice(0, 7)}.`);
    } else {
      const shown = subjects.slice(0, MAX_SUBJECTS).join("; ");
      const more = subjects.length > MAX_SUBJECTS ? "; ..." : "";
      const plural = subjects.length === 1 ? "commit" : "commits";
      lines.push(`main advanced ${subjects.length} ${plural}: ${shown}${more}`);
    }
  }
  if (before.branch !== after.branch) {
    lines.push(`branch changed from ${before.branch} to ${after.branch}.`);
  }
  for (const [plan, items] of Object.entries(after.plans)) {
    const old = before.plans[plan];
    const ticked = [];
    const added = [];
    for (const [title, checked] of Object.entries(items)) {
      if (!old || !(title in old)) {
        if (old) added.push(title);
      } else if (checked && !old[title]) {
        ticked.push(title);
      }
    }
    if (ticked.length > 0) lines.push(`${plan} ticked: ${ticked.join("; ")}`);
    if (added.length > 0) lines.push(`${plan} added: ${added.join("; ")}`);
  }
  for (const lock of after.locks) {
    if (!before.locks.includes(lock)) lines.push(`lock taken: ${lock}`);
  }
  for (const lock of before.locks) {
    if (!after.locks.includes(lock)) lines.push(`lock released: ${lock}`);
  }
  for (const [environment, operation] of Object.entries(after.journal)) {
    const old = before.journal[environment];
    if (old?.op === operation.op && old.outcome === operation.outcome) continue;
    lines.push(operationLine(environment, operation));
  }
  if (lines.length === 0) return "";
  const text = `Changed since your last turn: ${lines.join(" | ")}`;
  return text.length <= MAX_CHARS ? text : `${text.slice(0, MAX_CHARS - 3)}...`;
}

/** Delete other sessions' snapshots older than two weeks; errors are ignored. */
function prune(currentId, deps) {
  try {
    const cutoff = deps.now() - SNAPSHOT_MAX_AGE_MS;
    for (const { id, mtimeMs } of deps.listSnapshots()) {
      if (id === currentId || mtimeMs >= cutoff) continue;
      try {
        deps.removeSnapshot(id);
      } catch {
        // Pruning is housekeeping; a stuck file must not break the turn.
      }
    }
  } catch {
    // Same: an unreadable directory is not worth a failed prompt.
  }
}

/** Store this turn's snapshot and return what changed since the session's last one. */
export function update(sessionId, deps) {
  try {
    const before = deps.readSnapshot(sessionId);
    const after = snapshot(deps);
    deps.writeSnapshot(sessionId, after);
    prune(sessionId, deps);
    return before ? describeChanges(before, after, deps.commitsBetween) : "";
  } catch {
    return "";
  }
}

function realDeps(root) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  const snapshotFile = (id) =>
    join(
      resolve(root, git("rev-parse", "--git-dir")),
      "kore-delta",
      `${id}.json`,
    );
  const snapshotDir = () => join(snapshotFile("x"), "..");
  return {
    now: () => Date.now(),
    listSnapshots: () => {
      const dir = snapshotDir();
      let names;
      try {
        names = readdirSync(dir);
      } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw error;
      }
      return names
        .filter((name) => name.endsWith(".json"))
        .map((name) => ({
          id: name.slice(0, -".json".length),
          mtimeMs: statSync(join(dir, name)).mtimeMs,
        }));
    },
    removeSnapshot: (id) => unlinkSync(snapshotFile(id)),
    head: () => git("rev-parse", "HEAD"),
    branch: () => git("rev-parse", "--abbrev-ref", "HEAD"),
    main: () => {
      try {
        return git("rev-parse", "--verify", "--quiet", "main");
      } catch {
        return null;
      }
    },
    commitsBetween: (from, to) =>
      git("log", "--format=%s", `${from}..${to}`).split("\n").filter(Boolean),
    readPlans: () => readPlans(root),
    listLocks: () => {
      try {
        return readdirSync(join(root, LOCKS_DIR));
      } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw error;
      }
    },
    readJournals: () => readJournals(root),
    readSnapshot: (id) => {
      try {
        return JSON.parse(readFileSync(snapshotFile(id), "utf8"));
      } catch {
        return null;
      }
    },
    writeSnapshot: (id, snap) => {
      const file = snapshotFile(id);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, JSON.stringify(snap));
    },
  };
}

function main() {
  try {
    const event = JSON.parse(readFileSync(0, "utf8"));
    const id = event?.session_id;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) return 0;
    const root = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
    const context = update(id, realDeps(root));
    if (context) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: context,
          },
        }),
      );
    }
  } catch {
    // Fail open: a broken delta must never block a prompt.
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
