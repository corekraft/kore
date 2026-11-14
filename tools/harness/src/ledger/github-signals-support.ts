// Fixtures and fakes for the github-signals unit spec: the helpers of
// github-gh.ts stubbed to what they promise, a recorded signal, and one poll
// over fakes. Only that spec uses them, so they stay beside it (ADR 0098).
import { vi } from "vitest";
import {
  NOW,
  fakeClock,
  fakeFileSystem,
  fakeLedger,
  fakeRunner,
} from "./ledger-support.js";
import type { LedgerEvent } from "./schema.js";
import { pollSignals } from "./github-signals.js";
import { asRecord, count, list, pages, when, type Raw } from "./github-gh.js";
import { fromActions } from "./github-owner-actions.js";
import { acquire } from "./poll-lock.js";
import { heldLock } from "./github-poll-support.js";

export const REPO = "corekraft/kore";
export const OWNER = "junners";

/** The helpers, stubbed to what they promise: records, present times and whole counts. */
export function stubGhHelpers() {
  vi.mocked(asRecord).mockImplementation((value) =>
    typeof value === "object" && value !== null ? (value as Raw) : {},
  );
  vi.mocked(when).mockImplementation((value) =>
    typeof value === "string" ? value : undefined,
  );
  vi.mocked(count).mockImplementation((value) =>
    Number.isSafeInteger(value) && (value as number) >= 1
      ? (value as number)
      : undefined,
  );
}

/** Every listing empty, the lock free, and the helpers stubbed: the defaults each spec starts from. */
export function defaultSignals() {
  stubGhHelpers();
  vi.mocked(acquire).mockResolvedValue(heldLock());
  vi.mocked(pages).mockResolvedValue([]);
  vi.mocked(list).mockResolvedValue([]);
  vi.mocked(fromActions).mockResolvedValue([]);
}

/** A recorded GitHub event of `kind`, as the ledger would hold it. */
export const signal = (kind: string, id: string, occurredAt: string) =>
  ({
    id,
    source: "github",
    kind,
    occurredAt,
    schema: 1,
    recordedAt: occurredAt,
  }) as LedgerEvent;

const RUN_FIELDS = "databaseId,conclusion,updatedAt,attempt";
/** The most runs one listing returns: github-gh.ts's LIMIT. */
export const RUN_LIMIT = 200;

/** The `gh run list` call for the check workflow on main (pushed), and for nightly (scheduled). */
export const CHECK_LIST = [
  "run",
  "list",
  "--repo",
  REPO,
  "--workflow",
  "check.yml",
  "--branch",
  "main",
  "--event",
  "push",
  "--status",
  "completed",
  "--limit",
  String(RUN_LIMIT),
  "--json",
  RUN_FIELDS,
];

export const NIGHTLY_LIST = [
  "run",
  "list",
  "--repo",
  REPO,
  "--workflow",
  "nightly.yml",
  "--event",
  "schedule",
  "--status",
  "completed",
  "--limit",
  String(RUN_LIMIT),
  "--json",
  RUN_FIELDS,
];

/** The CI listings by workflow file; any other listing is empty. */
export function runs(check: Raw[] = [], nightly: Raw[] = []) {
  const answers: Record<string, Raw[]> = {
    "check.yml": check,
    "nightly.yml": nightly,
  };
  vi.mocked(list).mockImplementation((_runner, _what, args) => {
    const file = args[args.indexOf("--workflow") + 1] ?? "";
    return Promise.resolve(answers[file] ?? []);
  });
}

/** One poll over fakes, holding the given recorded events; `since` only when the test gives one. */
export function setupSignals(known: LedgerEvent[] = [], since?: string) {
  const runner = fakeRunner();
  const fake = fakeLedger();
  fake.list.mockResolvedValue({ events: known, skipped: 0 });
  fake.record.mockImplementation((input) =>
    Promise.resolve({
      ok: true,
      event: { ...input, schema: 1, recordedAt: NOW } as LedgerEvent,
    }),
  );
  const fs = fakeFileSystem();
  const clock = fakeClock();
  const poll = () =>
    pollSignals({
      ledger: fake.ledger,
      runner,
      clock,
      fs,
      repo: REPO,
      owner: OWNER,
      ...(since === undefined ? {} : { since }),
    });
  return { runner, fake, fs, clock, poll };
}
