import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATH } from "./ledger-support.js";
import { heldLock } from "./github-poll-support.js";
import {
  CHECK_LIST,
  NIGHTLY_LIST,
  OWNER,
  REPO,
  RUN_LIMIT,
  defaultSignals,
  runs,
  setupSignals,
  signal,
} from "./github-signals-support.js";
import { json, list, pages } from "./github-gh.js";
import { fromActions } from "./github-owner-actions.js";
import { acquire } from "./poll-lock.js";

// Factories, not automocks: an automock loads the real module, which the budget charges to each test.
vi.mock("./github-gh.js", () => ({
  DAY_MS: 86_400_000,
  LIMIT: 200,
  asRecord: vi.fn(),
  count: vi.fn(),
  json: vi.fn(),
  list: vi.fn(),
  pages: vi.fn(),
  when: vi.fn(),
}));
vi.mock("./github-owner-actions.js", () => ({ fromActions: vi.fn() }));
vi.mock("./poll-lock.js", () => ({ acquire: vi.fn() }));

const T = "2026-02-10T12:00:00Z";

beforeEach(defaultSignals);

describe("pollSignals: the lock", () => {
  it("polls under its own signals lock file, beside the ledger", async () => {
    const { fs, clock, poll } = setupSignals();
    await poll();
    expect(vi.mocked(acquire).mock.calls).toEqual([
      [fs, clock, `${PATH}.signals.lock`],
    ]);
  });

  it("reports busy, and asks GitHub nothing, when another poll holds the lock", async () => {
    const { poll } = setupSignals();
    vi.mocked(acquire).mockResolvedValue({ ok: false, message: "held" });
    expect(await poll()).toEqual({ ok: false, message: "held" });
    expect(vi.mocked(list)).not.toHaveBeenCalled();
    expect(vi.mocked(pages)).not.toHaveBeenCalled();
  });

  it("releases the lock after a listing fails", async () => {
    const { poll } = setupSignals();
    const held = heldLock();
    vi.mocked(acquire).mockResolvedValue(held);
    vi.mocked(pages).mockResolvedValue("gh api commits failed");
    await poll();
    expect(held.release).toHaveBeenCalledTimes(1);
  });
});

describe("pollSignals: where it starts", () => {
  it("lists with no since when nothing is recorded", async () => {
    const { runner, poll } = setupSignals();
    await poll();
    expect(vi.mocked(list).mock.calls[0]?.[2]).not.toContain("--created");
    expect(vi.mocked(fromActions).mock.calls).toEqual([
      [runner, REPO, OWNER, undefined],
    ]);
  });

  it("starts a day before the latest recorded signal, ignoring other kinds", async () => {
    const { poll } = setupSignals([
      signal("ci.main", "github:ci.main:1", "2026-02-10T12:00:00.000Z"),
      signal(
        "issue.opened",
        "github:issue.opened:2",
        "2026-03-01T00:00:00.000Z",
      ),
    ]);
    await poll();
    expect(vi.mocked(list).mock.calls[0]?.[2]).toContain(">=2026-02-09");
    expect(vi.mocked(pages).mock.calls[0]?.[3]).toBe("2026-02-09T12:00:00Z");
  });

  it("uses --since when it reaches back further than that", async () => {
    const { poll } = setupSignals(
      [signal("ci.main", "github:ci.main:1", `${T}.000Z`)],
      "2026-01-01T00:00:00Z",
    );
    await poll();
    expect(vi.mocked(fromActions).mock.calls[0]?.[3]).toBe(
      "2026-01-01T00:00:00Z",
    );
  });
});

describe("pollSignals: CI runs, listed", () => {
  it("lists check runs on main by push, and nightly runs by schedule", async () => {
    const { poll } = setupSignals();
    await poll();
    expect(vi.mocked(list).mock.calls.map((c) => c[2])).toEqual([
      CHECK_LIST,
      NIGHTLY_LIST,
    ]);
  });

  it("drops a run with no conclusion yet", async () => {
    const { fake, poll } = setupSignals();
    runs([{ databaseId: 7, conclusion: "", updatedAt: T, attempt: 1 }]);
    await poll();
    expect(fake.record).not.toHaveBeenCalled();
  });

  it("refuses a full run listing, since some runs may be missing", async () => {
    const { poll } = setupSignals();
    runs(Array.from({ length: RUN_LIMIT }, (_, i) => ({ databaseId: i + 1 })));
    expect(await poll()).toEqual({
      ok: false,
      message:
        "gh returned 200 check.yml runs, the most one poll lists, so some may be missing. Pass --since with a later time.",
    });
  });

  it("returns the message of a run listing that failed", async () => {
    const { poll } = setupSignals();
    vi.mocked(list).mockResolvedValue("gh run list failed");
    expect(await poll()).toEqual({ ok: false, message: "gh run list failed" });
  });
});

describe("pollSignals: CI runs, judged", () => {
  it("records a passing run as success, and any other conclusion as failure", async () => {
    const { fake, poll } = setupSignals();
    runs([
      { databaseId: 7, conclusion: "success", updatedAt: T, attempt: 1 },
      { databaseId: 8, conclusion: "timed_out", updatedAt: T, attempt: 1 },
    ]);
    await poll();
    expect(fake.record.mock.calls.map((c) => c[0])).toEqual([
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
    ]);
  });

  it("judges a re-run by its first attempt, so a failure re-run to success still counts", async () => {
    const { fake, poll } = setupSignals();
    runs([{ databaseId: 9, conclusion: "success", updatedAt: T, attempt: 2 }]);
    vi.mocked(json).mockResolvedValue({
      conclusion: "failure",
      updated_at: "2026-02-10T11:00:00Z",
    });
    await poll();
    expect(vi.mocked(json).mock.calls[0]?.[2]).toEqual([
      "api",
      "repos/corekraft/kore/actions/runs/9/attempts/1",
    ]);
    expect(fake.record.mock.calls[0]?.[0]).toMatchObject({
      id: "github:ci.main:9",
      occurredAt: "2026-02-10T11:00:00Z",
      outcome: "failure",
    });
  });

  it("does not look at a run it already holds", async () => {
    const { fake, poll } = setupSignals([
      signal("ci.main", "github:ci.main:7", `${T}.000Z`),
    ]);
    runs([{ databaseId: 7, conclusion: "success", updatedAt: T, attempt: 1 }]);
    await poll();
    expect(fake.record).not.toHaveBeenCalled();
  });

  it("returns the message when a first attempt cannot be read", async () => {
    const { poll } = setupSignals();
    runs([{ databaseId: 9, conclusion: "success", updatedAt: T, attempt: 2 }]);
    vi.mocked(json).mockResolvedValue("gh api run attempt failed");
    expect(await poll()).toEqual({
      ok: false,
      message: "gh api run attempt failed",
    });
  });
});

describe("pollSignals: reverts on main", () => {
  it("records a commit that reverts another, by its subject or its body", async () => {
    const { fake, poll } = setupSignals();
    vi.mocked(pages).mockResolvedValue([
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
      {
        sha: "0123456",
        commit: { message: "feat: y", committer: { date: T } },
      },
    ]);
    await poll();
    expect(vi.mocked(pages).mock.calls[0]?.[2]).toBe(
      "repos/corekraft/kore/commits?sha=main",
    );
    expect(fake.record.mock.calls.map((c) => c[0].id)).toEqual([
      "github:main.revert:abc1234",
      "github:main.revert:def5678",
    ]);
  });

  it("ignores a commit whose id is not hex, or that has no time", async () => {
    const { fake, poll } = setupSignals();
    vi.mocked(pages).mockResolvedValue([
      {
        sha: "XYZ1234",
        commit: { message: 'Revert "x"', committer: { date: T } },
      },
      { sha: "abc1234", commit: { message: 'Revert "x"', committer: {} } },
    ]);
    await poll();
    expect(fake.record).not.toHaveBeenCalled();
  });

  it("returns the message of a commit listing that failed", async () => {
    const { poll } = setupSignals();
    vi.mocked(pages).mockResolvedValue("gh api commits failed");
    expect(await poll()).toEqual({
      ok: false,
      message: "gh api commits failed",
    });
  });
});

describe("pollSignals: the owner's actions and recording", () => {
  it("records the owner's actions that GitHub reports", async () => {
    const { fake, poll } = setupSignals();
    vi.mocked(fromActions).mockResolvedValue([
      {
        id: "github:owner.action:comment:5",
        source: "github",
        kind: "owner.action",
        occurredAt: T,
        number: 7,
      },
    ]);
    await poll();
    expect(fake.record.mock.calls.map((c) => c[0].kind)).toEqual([
      "owner.action",
    ]);
  });

  it("returns the message when the owner's actions cannot be read, and records nothing", async () => {
    const { fake, poll } = setupSignals();
    vi.mocked(fromActions).mockResolvedValue("gh api issues/comments failed");
    expect(await poll()).toEqual({
      ok: false,
      message: "gh api issues/comments failed",
    });
    expect(fake.record).not.toHaveBeenCalled();
  });

  it("records in time order, skipping what the ledger holds", async () => {
    const { fake, poll } = setupSignals([
      signal("owner.action", "github:owner.action:comment:5", `${T}.000Z`),
    ]);
    vi.mocked(fromActions).mockResolvedValue([
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
    ]);
    runs([
      {
        databaseId: 3,
        conclusion: "success",
        updatedAt: "2026-02-09T00:00:00Z",
        attempt: 1,
      },
    ]);
    const result = await poll();
    expect(result).toMatchObject({ ok: true, recorded: 2 });
    expect(fake.record.mock.calls.map((c) => c[0].id)).toEqual([
      "github:ci.main:3",
      "github:owner.action:review:6",
    ]);
  });

  it("stops at the first record the ledger refuses, and returns its message", async () => {
    const { fake, poll } = setupSignals();
    runs([{ databaseId: 7, conclusion: "success", updatedAt: T, attempt: 1 }]);
    fake.record.mockResolvedValue({ ok: false, field: "kind", message: "no" });
    expect(await poll()).toEqual({ ok: false, message: "no" });
    expect(fake.record).toHaveBeenCalledTimes(1);
  });
});
