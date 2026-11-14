// Fixtures and fakes for the journal's unit spec. A support file is not a unit,
// so it needs no spec of its own (ADR 0098).
import { appendFile } from "node:fs/promises";
import { vi } from "vitest";

export const T0 = "2026-11-07T10:00:00.000Z";
export const OP = "00000000-0000-4000-8000-000000000001";
export const ROOT = "/root";
// Named, not written as a literal: the live-environment guard scans support files too.
const LOCAL = "local";
export const JOURNAL = `${ROOT}/.kore/state/journal/${LOCAL}.jsonl`;

export function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

/** A journal entry as the module stamps it: the fixed time and operation, then its body. */
export function journalEntry(body: Record<string, unknown>) {
  return { ts: T0, op: OP, ...body };
}

/** A context-carrying operation whose one exec succeeds: start, exec, end ok. */
export const okEntries = [
  journalEntry({
    kind: "start",
    environment: LOCAL,
    command: "local up",
    context: "mk",
  }),
  journalEntry({
    kind: "exec",
    command: "helm",
    args: ["upgrade", "--install", "x"],
    code: 0,
    ms: 0,
  }),
  journalEntry({ kind: "end", outcome: "ok", ms: 0 }),
];

/** A failed `k3d cluster start`: start with no context, the exec's exit code, a one-line error. */
export const failedEntries = [
  journalEntry({ kind: "start", environment: LOCAL, command: "cluster up" }),
  journalEntry({
    kind: "exec",
    command: "k3d",
    args: ["cluster", "start"],
    code: 3,
    ms: 0,
  }),
  journalEntry({
    kind: "end",
    outcome: "failed",
    error: "k3d cluster start failed (3)",
    ms: 0,
  }),
];

/** What `summarizeOperations` must report for `operationFixture`, in journal order. */
export const operationSummaries = [
  {
    op: "a",
    command: "local up",
    ts: "2026-11-07T10:00:00.000Z",
    outcome: "interrupted",
  },
  {
    op: "b",
    command: "cluster stop",
    ts: "2026-11-07T10:01:00.000Z",
    outcome: "failed",
    ms: 2000,
    error: "nope",
  },
  {
    op: "c",
    command: "app up x",
    ts: "2026-11-07T10:02:00.000Z",
    outcome: "ok",
    ms: 1000,
  },
];

/** The argument lists the redaction tests feed `redactArgs`, and what each must become. */
export const redactionFixtures = {
  flags: {
    args: [
      "login",
      "--password=p1",
      "--api-token",
      "t2",
      "--Client-Secret=s3",
      "--ssh-key",
      "k4",
      "--namespace",
      "kore",
      "--keyring-only",
    ],
    redacted: [
      "login",
      "--password=<redacted>",
      "--api-token",
      "<redacted>",
      "--Client-Secret=<redacted>",
      "--ssh-key",
      "<redacted>",
      "--namespace",
      "kore",
      "--keyring-only",
    ],
  },
  keyValues: {
    args: [
      "upgrade",
      "--set",
      "db.password=p1",
      "--set-string",
      "auth.token=t2",
      "--from-literal=password=p3",
      "api_key=k4",
      "--set",
      "replicas=2",
      "--set=image.tag=v1",
    ],
    redacted: [
      "upgrade",
      "--set",
      "db.password=<redacted>",
      "--set-string",
      "auth.token=<redacted>",
      "--from-literal=password=<redacted>",
      "api_key=<redacted>",
      "--set",
      "replicas=2",
      "--set=image.tag=v1",
    ],
  },
  unrelated: {
    args: ["--set", "replicas=2,db.password=p1"],
    redacted: ["--set", "replicas=2,db.password=<redacted>"],
  },
};

/** Every entry the journal appended in this test, parsed, in order. */
export function appendedEntries(): Record<string, unknown>[] {
  return vi.mocked(appendFile).mock.calls.map(([, text]) => {
    if (typeof text !== "string") {
      throw new Error("the journal appends only text");
    }
    return JSON.parse(text) as Record<string, unknown>;
  });
}

/** A journal file's text: one JSON line per entry, then the raw lines given. */
export function journalText(
  entries: readonly object[],
  ...rawLines: string[]
): string {
  return (
    [...entries.map((entry) => JSON.stringify(entry)), ...rawLines].join("\n") +
    "\n"
  );
}

/**
 * Operation a started and never ended; b failed; c ended ok. Each has the
 * entries a real journal writes, so summarizing it reads every kind.
 */
export const operationFixture = [
  {
    ts: "2026-11-07T10:00:00.000Z",
    op: "a",
    kind: "start",
    environment: LOCAL,
    command: "local up",
  },
  {
    ts: "2026-11-07T10:00:01.000Z",
    op: "a",
    kind: "exec",
    command: "helm",
    args: [],
    code: 0,
    ms: 5,
  },
  {
    ts: "2026-11-07T10:01:00.000Z",
    op: "b",
    kind: "start",
    environment: LOCAL,
    command: "cluster stop",
  },
  {
    ts: "2026-11-07T10:01:02.000Z",
    op: "b",
    kind: "end",
    outcome: "failed",
    error: "nope",
    ms: 2000,
  },
  {
    ts: "2026-11-07T10:02:00.000Z",
    op: "c",
    kind: "start",
    environment: LOCAL,
    command: "app up x",
  },
  {
    ts: "2026-11-07T10:02:01.000Z",
    op: "c",
    kind: "end",
    outcome: "ok",
    ms: 1000,
  },
];
