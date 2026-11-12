// Delta: tells the agent what changed since its previous turn: new commits on
// main, plan items ticked or added, locks taken or released, and journal
// operations started, finished, or failed. Parallel Herdr sessions change all
// of these between turns. The first prompt of a session only writes the
// baseline snapshot; an unchanged repository prints nothing.
// Plan: infra/plans/6-agent-primitives.md#step-3-what-changed-between-turns

import { activePlans, listItems } from "../plan/index.js";

const MAX_CHARS = 600;
const MAX_ITEM_CHARS = 60;
const MAX_SUBJECTS = 3;
const SNAPSHOT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface JournalEntry {
  op?: string;
  kind?: string;
  command?: string;
  outcome?: string;
  error?: string;
}

interface Operation {
  op: string;
  command: string;
  outcome: string | null;
  error?: string;
}

/** The comparable state of the repository and platform files at one prompt. */
export interface Snapshot {
  head: string;
  branch: string;
  main: string | null;
  /** Ticked state per plan item: {planName: {itemTitle: checked}}. */
  plans: Record<string, Record<string, boolean>>;
  locks: string[];
  journal: Record<string, Operation>;
}

/** Everything delta reads and writes, so tests inject it instead of git and disk. */
export interface DeltaDeps {
  head(): Promise<string>;
  branch(): Promise<string>;
  main(): Promise<string | null>;
  commitsBetween(from: string, to: string): Promise<string[]>;
  readPlans(): Promise<Record<string, string>>;
  listLocks(): Promise<string[]>;
  readJournals(): Promise<Record<string, JournalEntry[]>>;
  readSnapshot(id: string): Promise<Snapshot | null>;
  writeSnapshot(id: string, snapshot: Snapshot): Promise<void>;
  listSnapshots(): Promise<{ id: string; mtimeMs: number }[]>;
  removeSnapshot(id: string): Promise<void>;
  now(): number;
}

/** The latest operation in a journal; outcome is null when it was interrupted. */
function lastOperation(entries: JournalEntry[]): Operation | null {
  const start = entries.findLast((entry) => entry.kind === "start");
  if (start === undefined) {
    return null;
  }
  const end = entries.findLast(
    (entry) => entry.kind === "end" && entry.op === start.op,
  );
  return {
    op: start.op ?? "",
    command: start.command ?? "",
    outcome: end?.outcome ?? null,
    ...(end?.error ? { error: end.error } : {}),
  };
}

function planItems(
  plans: Record<string, string>,
): Record<string, Record<string, boolean>> {
  const result: Record<string, Record<string, boolean>> = {};
  for (const name of activePlans(plans)) {
    const items: Record<string, boolean> = {};
    for (const { text } of listItems(plans[name] ?? "")) {
      const match = /^- \[( |x)\] (.*)$/.exec(text);
      if (match === null) {
        continue;
      }
      const title = (match[2] ?? "")
        .replaceAll("**", "")
        .slice(0, MAX_ITEM_CHARS);
      items[title] = match[1] === "x";
    }
    result[name] = items;
  }
  return result;
}

/** The comparable state of the repository and platform files right now. */
export async function snapshot(deps: DeltaDeps): Promise<Snapshot> {
  const journal: Record<string, Operation> = {};
  for (const [environment, entries] of Object.entries(
    await deps.readJournals(),
  )) {
    const last = lastOperation(entries);
    if (last !== null) {
      journal[environment] = last;
    }
  }
  return {
    head: await deps.head(),
    branch: await deps.branch(),
    main: await deps.main(),
    plans: planItems(await deps.readPlans()),
    locks: [...(await deps.listLocks())].sort(),
    journal,
  };
}

function operationLine(environment: string, operation: Operation): string {
  const command = `\`${operation.command}\``;
  if (operation.outcome === null) {
    return `${environment}: ${command} started`;
  }
  if (operation.outcome === "failed") {
    return `${environment}: ${command} failed${operation.error ? `: ${operation.error}` : ""}`;
  }
  return `${environment}: ${command} finished ${operation.outcome}`;
}

function planLines(before: Snapshot, after: Snapshot): string[] {
  const lines: string[] = [];
  for (const [plan, items] of Object.entries(after.plans)) {
    const old = before.plans[plan];
    const ticked: string[] = [];
    const added: string[] = [];
    for (const [title, checked] of Object.entries(items)) {
      if (old === undefined || !(title in old)) {
        if (old !== undefined) {
          added.push(title);
        }
      } else if (checked && old[title] !== true) {
        ticked.push(title);
      }
    }
    if (ticked.length > 0) {
      lines.push(`${plan} ticked: ${ticked.join("; ")}`);
    }
    if (added.length > 0) {
      lines.push(`${plan} added: ${added.join("; ")}`);
    }
  }
  return lines;
}

function mainLine(
  before: Snapshot,
  after: Snapshot,
  subjects: (from: string, to: string) => string[],
): string[] {
  if (before.main === after.main || after.main === null) {
    return [];
  }
  const found = before.main === null ? [] : subjects(before.main, after.main);
  if (found.length === 0) {
    return [`main moved to ${after.main.slice(0, 7)}.`];
  }
  const shown = found.slice(0, MAX_SUBJECTS).join("; ");
  const more = found.length > MAX_SUBJECTS ? "; ..." : "";
  const plural = found.length === 1 ? "commit" : "commits";
  return [`main advanced ${found.length} ${plural}: ${shown}${more}`];
}

function lockLines(before: Snapshot, after: Snapshot): string[] {
  return [
    ...after.locks
      .filter((lock) => !before.locks.includes(lock))
      .map((lock) => `lock taken: ${lock}`),
    ...before.locks
      .filter((lock) => !after.locks.includes(lock))
      .map((lock) => `lock released: ${lock}`),
  ];
}

function journalLines(before: Snapshot, after: Snapshot): string[] {
  return Object.entries(after.journal)
    .filter(([environment, operation]) => {
      const old = before.journal[environment];
      return old?.op !== operation.op || old.outcome !== operation.outcome;
    })
    .map(([environment, operation]) => operationLine(environment, operation));
}

/** What differs between two snapshots, at most 600 characters; empty when nothing does. */
export function describeChanges(
  before: Snapshot,
  after: Snapshot,
  subjects: (from: string, to: string) => string[],
): string {
  const lines = [
    ...mainLine(before, after, subjects),
    ...(before.branch === after.branch
      ? []
      : [`branch changed from ${before.branch} to ${after.branch}.`]),
    ...planLines(before, after),
    ...lockLines(before, after),
    ...journalLines(before, after),
  ];
  if (lines.length === 0) {
    return "";
  }
  const text = `Changed since your last turn: ${lines.join(" | ")}`;
  return text.length <= MAX_CHARS ? text : `${text.slice(0, MAX_CHARS - 3)}...`;
}

/** Delete other sessions' snapshots older than two weeks; errors are ignored. */
async function prune(currentId: string, deps: DeltaDeps): Promise<void> {
  try {
    const cutoff = deps.now() - SNAPSHOT_MAX_AGE_MS;
    for (const { id, mtimeMs } of await deps.listSnapshots()) {
      if (id === currentId || mtimeMs >= cutoff) {
        continue;
      }
      try {
        await deps.removeSnapshot(id);
      } catch {
        // Pruning is housekeeping; a stuck file must not break the turn.
      }
    }
  } catch {
    // Same: an unreadable directory is not worth a failed prompt.
  }
}

/**
 * Stores this turn's snapshot and returns what changed since the session's
 * last one. Fails open: any error yields no context.
 */
export async function update(
  sessionId: string,
  deps: DeltaDeps,
): Promise<string> {
  try {
    const before = await deps.readSnapshot(sessionId);
    const after = await snapshot(deps);
    await deps.writeSnapshot(sessionId, after);
    await prune(sessionId, deps);
    if (before === null) {
      return "";
    }
    const subjects = new Map<string, string[]>();
    if (
      before.main !== after.main &&
      before.main !== null &&
      after.main !== null
    ) {
      subjects.set(
        `${before.main}..${after.main}`,
        await deps.commitsBetween(before.main, after.main),
      );
    }
    return describeChanges(
      before,
      after,
      (from, to) => subjects.get(`${from}..${to}`) ?? [],
    );
  } catch {
    return "";
  }
}
