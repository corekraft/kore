// Fixtures and fakes for the github-poll unit spec: what `gh` answers, the
// lock a poll holds, the canned GitHub items, and one poll over fakes. Only
// that spec uses them, so they stay beside it (ADR 0098).
import { vi } from "vitest";
import {
  NOW,
  fakeClock,
  fakeFileSystem,
  fakeLedger,
  fakeRunner,
  failed,
  ok,
  type FakeRunner,
} from "./ledger-support.js";
import type { LedgerEvent } from "./schema.js";
import { pollGithub } from "./github-poll.js";

const REPO = "corekraft/kore";

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

/** One poll over fakes; `since` is passed only when the test gives one. */
export function setup(gh: Gh, since?: string) {
  const runner = fakeRunner();
  answerGh(runner, gh);
  const fake = fakeLedger();
  fake.list.mockResolvedValue({ events: [], skipped: 0 });
  fake.record.mockImplementation((input) =>
    Promise.resolve({
      ok: true,
      event: { ...input, schema: 1, recordedAt: NOW } as LedgerEvent,
    }),
  );
  const fs = fakeFileSystem();
  const clock = fakeClock();
  const poll = () =>
    pollGithub({
      ledger: fake.ledger,
      runner,
      clock,
      fs,
      repo: REPO,
      ...(since === undefined ? {} : { since }),
    });
  return { runner, fake, fs, clock, poll };
}

/** The label-event listings that were read, by their gh call. */
export const eventReads = (runner: FakeRunner) =>
  runner.run.mock.calls.filter((c) => c[1].join(" ").includes("issues/events"));
