// Fakes and data for the github-signals unit spec: the helpers of github-gh.ts
// stubbed to what they promise, the mocks' defaults, the CI listings, and what
// a poll should record for them. Only that spec uses them, so they stay beside
// it (ADR 0098). No unit is imported here.
import { vi } from "vitest";
import { asRecord, count, list, pages, when, type Raw } from "./github-gh.js";
import { fromActions } from "./github-owner-actions.js";
import { acquire } from "./poll-lock.js";
import { heldLock } from "./github-poll-support.js";
import type { EventInput, LedgerEvent } from "./schema.js";

export const REPO = "corekraft/kore";
export const OWNER = "junners";
export const T = "2026-02-10T12:00:00Z";

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

/** What a poll records for passing run 7 and failing run 8 on main. */
export const CI_RECORDS = [
  {
    id: "github:ci.main:7",
    source: "github",
    kind: "ci.main",
    occurredAt: T,
    outcome: "success",
  },
  {
    id: "github:ci.main:8",
    source: "github",
    kind: "ci.main",
    occurredAt: T,
    outcome: "failure",
  },
];

/** Commits on main: two reverts (by subject, by body) and one that is not. */
export const REVERT_COMMITS = [
  {
    sha: "abc1234",
    commit: { message: 'Revert "feat: x"', committer: { date: T } },
  },
  {
    sha: "def5678",
    commit: {
      message: "fix\n\nThis reverts commit 1234567.",
      committer: { date: T },
    },
  },
  { sha: "0123456", commit: { message: "feat: y", committer: { date: T } } },
];

/** The owner's comment 5, and their review 6 a day later, as fromActions returns them. */
export const OWNER_ACTIONS: EventInput[] = [
  {
    id: "github:owner.action:comment:5",
    source: "github",
    kind: "owner.action",
    occurredAt: T,
    number: 7,
  },
  {
    id: "github:owner.action:review:6",
    source: "github",
    kind: "owner.action",
    occurredAt: "2026-02-11T00:00:00Z",
    number: 7,
  },
];
