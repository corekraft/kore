import { describe, expect, it } from "vitest";
import type { Runner } from "../runtime/index.js";
import { MemoryFileSystem } from "../runtime/memory-filesystem-support.js";
import { Ledger } from "./ledger.js";
import { pollSignals } from "./github-signals.js";

const PATH = "/repo/.kore/state/ledger.jsonl";

/** Answers each `gh` call by a fragment of its arguments; anything else is an empty list. */
function setup(answers: Record<string, unknown>, code = 0) {
  const fs = new MemoryFileSystem();
  const clock = {
    now: () => new Date("2026-02-01T00:00:00Z"),
    sleep: () => Promise.resolve(),
  };
  let n = 0;
  const ledger = new Ledger(fs, clock, { next: () => `id-${++n}` }, PATH);
  const calls: string[] = [];
  const runner: Runner = {
    run(_command, args) {
      const text = args.join(" ");
      calls.push(text);
      const key = Object.keys(answers).find((k) => text.includes(k));
      return Promise.resolve({
        stdout: JSON.stringify(key === undefined ? [] : answers[key]),
        stderr: code === 0 ? "" : "boom",
        code,
      });
    },
  } as Runner;
  const poll = () =>
    pollSignals({
      ledger,
      runner,
      clock,
      fs,
      repo: "corekraft/kore",
      owner: "junners",
    });
  const stored = async () => (await ledger.list({})).events;
  return { poll, stored, calls, ledger };
}

const run = (databaseId: number, conclusion: string, updatedAt: string) => ({
  databaseId,
  conclusion,
  updatedAt,
  displayTitle: "secret title",
});

describe("pollSignals workflow runs", () => {
  it("records main's check conclusions and the nightly's, at the time GitHub concluded them", async () => {
    const t = setup({
      "--workflow check.yml": [
        run(1, "success", "2026-01-05T10:00:00Z"),
        run(2, "failure", "2026-01-05T11:00:00Z"),
      ],
      "--workflow nightly.yml": [run(3, "success", "2026-01-06T03:20:00Z")],
    });
    expect(await t.poll()).toMatchObject({ ok: true, recorded: 3 });
    const events = await t.stored();
    expect(events.map((e) => [e.kind, e.outcome, e.occurredAt])).toEqual([
      ["ci.main", "success", "2026-01-05T10:00:00Z"],
      ["ci.main", "failure", "2026-01-05T11:00:00Z"],
      ["ci.nightly", "success", "2026-01-06T03:20:00Z"],
    ]);
    expect(JSON.stringify(events)).not.toMatch(/secret/);
  });

  it("asks only for check runs on main", async () => {
    const t = setup({});
    await t.poll();
    expect(t.calls.find((c) => c.includes("check.yml"))).toContain(
      "--branch main",
    );
  });

  it("counts a timed-out run as a failure and leaves cancelled and skipped runs out", async () => {
    const t = setup({
      "--workflow check.yml": [
        run(1, "timed_out", "2026-01-05T10:00:00Z"),
        run(2, "cancelled", "2026-01-05T11:00:00Z"),
        run(3, "skipped", "2026-01-05T12:00:00Z"),
      ],
    });
    await t.poll();
    expect((await t.stored()).map((e) => e.outcome)).toEqual(["failure"]);
  });

  it("appends nothing the second time", async () => {
    const t = setup({
      "--workflow check.yml": [run(1, "success", "2026-01-05T10:00:00Z")],
    });
    await t.poll();
    expect(await t.poll()).toMatchObject({ ok: true, recorded: 0 });
  });
});

describe("pollSignals cannot be steered by running workflows by hand", () => {
  it("asks for push runs on main and scheduled nightly runs only", async () => {
    const t = setup({});
    await t.poll();
    expect(t.calls.find((c) => c.includes("check.yml"))).toContain(
      "--event push",
    );
    expect(t.calls.find((c) => c.includes("nightly.yml"))).toContain(
      "--event schedule",
    );
  });
});

describe("pollSignals reverts", () => {
  it("records a merged pull request whose title starts with Revert, never the title", async () => {
    const t = setup({
      "pr list": [
        {
          number: 9,
          mergedAt: "2026-01-05T10:00:00Z",
          title: 'Revert "feat: secret"',
        },
        {
          number: 10,
          mergedAt: "2026-01-05T11:00:00Z",
          title: "feat: reverting nothing",
        },
      ],
    });
    await t.poll();
    const events = (await t.stored()).filter((e) => e.kind === "pr.reverted");
    expect(events.map((e) => [e.number, e.occurredAt])).toEqual([
      [9, "2026-01-05T10:00:00Z"],
    ]);
    expect(JSON.stringify(events)).not.toMatch(/secret/);
  });
});

describe("pollSignals owner actions", () => {
  it("records only the owner's comments and issue events, by number and time", async () => {
    const t = setup({
      "issues/comments": [
        {
          id: 1,
          created_at: "2026-01-05T10:00:00Z",
          issue_url: "https://api.github.com/repos/corekraft/kore/issues/7",
          user: { login: "junners" },
          body: "secret",
        },
        {
          id: 2,
          created_at: "2026-01-05T10:01:00Z",
          issue_url: "https://api.github.com/repos/corekraft/kore/issues/7",
          user: { login: "someone-else" },
          body: "secret",
        },
      ],
      "issues/events": [
        {
          id: 5,
          event: "labeled",
          created_at: "2026-01-05T10:02:00Z",
          issue: { number: 8 },
          actor: { login: "junners" },
        },
        {
          id: 6,
          event: "labeled",
          created_at: "2026-01-05T10:03:00Z",
          issue: { number: 8 },
          actor: { login: "claude[bot]" },
        },
      ],
    });
    await t.poll();
    const events = (await t.stored()).filter((e) => e.kind === "owner.action");
    expect(events.map((e) => [e.number, e.occurredAt])).toEqual([
      [7, "2026-01-05T10:00:00Z"],
      [8, "2026-01-05T10:02:00Z"],
    ]);
    expect(JSON.stringify(events)).not.toMatch(/secret|junners/);
  });
});

describe("pollSignals owner action paging", () => {
  const full = (from: number, minute: number) =>
    Array.from({ length: 100 }, (_, i) => ({
      id: from + i,
      event: "labeled",
      created_at: `2026-01-05T10:${String(minute).padStart(2, "0")}:00Z`,
      issue: { number: 8 },
      actor: { login: "claude[bot]" },
    }));

  it("refuses to record when more events arrived since the last owner action than it can page through", async () => {
    const t = setup({ "issues/events": full(1, 30) });
    await t.ledger.record({
      id: "github:owner.action:event:0",
      source: "github",
      kind: "owner.action",
      occurredAt: "2026-01-05T09:00:00Z",
      number: 1,
    });
    const result = await t.poll();
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toMatch(/Poll more often/);
  });

  it("takes the newest events on a first poll, which has no bound", async () => {
    const t = setup({ "issues/events": full(1, 30) });
    expect((await t.poll()).ok).toBe(true);
  });
});

describe("pollSignals failures", () => {
  it("names the failing gh call and records nothing", async () => {
    const t = setup({}, 1);
    const result = await t.poll();
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? "" : result.message).toMatch(/gh run list failed/);
    expect(await t.stored()).toEqual([]);
  });
});
