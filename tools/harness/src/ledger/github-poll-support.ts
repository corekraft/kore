// Fakes and data for the github-poll unit spec: what `gh` answers, the lock a
// poll holds, a recorded event, the canned GitHub items, and what a poll
// should record for them. Only that spec uses them, so they stay beside it
// (ADR 0098). No unit is imported here.
import { vi } from "vitest";
import { failed, ok, type FakeRunner } from "./ledger-support.js";
import type { LedgerEvent } from "./schema.js";

/** What `gh` answers: a list per call, the events one page at a time, or a failure. */
export interface Gh {
  issues?: unknown;
  prs?: unknown;
  events?: unknown[][];
  failure?: { code: number; stderr: string };
  rateLimit?: string;
}

/** Answers each `gh` call the way GitHub does, by the arguments; a string is printed as it is. */
export function answerGh(runner: FakeRunner, gh: Gh) {
  runner.run.mockImplementation((_command, args) => {
    const text = args.join(" ");
    if (text.includes("rate_limit")) {
      return Promise.resolve(ok(gh.rateLimit ?? "{}"));
    }
    if (gh.failure !== undefined) {
      return Promise.resolve(failed(gh.failure.code, gh.failure.stderr));
    }
    if (args[0] === "issue" || args[0] === "pr") {
      const value = args[0] === "issue" ? gh.issues : gh.prs;
      return Promise.resolve(
        ok(typeof value === "string" ? value : JSON.stringify(value ?? [])),
      );
    }
    const page = Number(/&page=(\d+)/.exec(text)?.[1] ?? "1");
    return Promise.resolve(ok(JSON.stringify(gh.events?.[page - 1] ?? [])));
  });
}

/** A lock this poll can hold; the tests read its refresh and release calls. */
export function heldLock() {
  return {
    ok: true as const,
    refresh: vi.fn(() => Promise.resolve()),
    release: vi.fn(() => Promise.resolve()),
  };
}

/** A ledger event already recorded, for the dedupe and the `since` default. */
export const known = (id: string, occurredAt: string) =>
  ({
    id,
    source: "github",
    kind: "issue.opened",
    occurredAt,
    schema: 1,
    recordedAt: occurredAt,
  }) as LedgerEvent;

/** Canned GitHub items. Titles and bodies are included on purpose: they must never be recorded. */
export const ISSUE = {
  number: 7,
  createdAt: "2026-01-05T00:00:00Z",
  closedAt: "2026-01-09T00:00:00Z",
  title: "secret title",
  body: "secret body",
};

export const PR = {
  number: 9,
  createdAt: "2026-01-06T00:00:00Z",
  mergedAt: "2026-01-08T00:00:00Z",
  closingIssuesReferences: [{ number: 7 }],
  title: "secret title",
  body: "secret body",
};

/** The `record` calls a poll makes for ISSUE: opened, then closed. */
export const ISSUE_CALLS = [
  [
    {
      id: "github:issue.opened:7",
      source: "github",
      kind: "issue.opened",
      occurredAt: "2026-01-05T00:00:00Z",
      number: 7,
    },
  ],
  [
    {
      id: "github:issue.closed:7",
      source: "github",
      kind: "issue.closed",
      occurredAt: "2026-01-09T00:00:00Z",
      number: 7,
    },
  ],
];

/** The `record` calls a poll makes for PR: opened, then merged, under the issue it closes. */
export const PR_CALLS = [
  [
    {
      id: "github:pr.opened:9",
      source: "github",
      kind: "pr.opened",
      occurredAt: "2026-01-06T00:00:00Z",
      number: 9,
      idea: "#7",
    },
  ],
  [
    {
      id: "github:pr.merged:9",
      source: "github",
      kind: "pr.merged",
      occurredAt: "2026-01-08T00:00:00Z",
      number: 9,
      idea: "#7",
    },
  ],
];

/** The label event a poll records from `LABEL_EVENT`. */
export const LABEL_EVENT = [
  [
    {
      id: 4,
      event: "labeled",
      created_at: "2026-01-07T00:00:00Z",
      label: { name: "bug" },
      issue: { number: 7 },
    },
  ],
];

export const LABEL_CALLS = [
  [
    {
      id: "github:issue.labelled:4",
      source: "github",
      kind: "issue.labelled",
      occurredAt: "2026-01-07T00:00:00Z",
      number: 7,
      label: "bug",
    },
  ],
];

/** The `gh issue list` arguments a poll asks for when the latest signal is on 2026-01-12. */
export const ISSUE_LIST_ARGS = [
  "issue",
  "list",
  "--repo",
  "corekraft/kore",
  "--state",
  "all",
  "--limit",
  "1000",
  "--search",
  "updated:>=2026-01-12",
  "--json",
  "number,createdAt,closedAt",
];
