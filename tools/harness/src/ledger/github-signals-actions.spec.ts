import { describe, expect, it } from "vitest";
import { setup } from "./github-signals-support.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const commit = (sha: string, message: string, date: string) => ({
  sha,
  commit: { message, committer: { date } },
});

describe("pollSignals reverts", () => {
  it('records a commit on main whose subject starts Revert " or whose body says it reverts a commit', async () => {
    const t = setup({
      "repos/corekraft/kore/commits": [
        commit(A, 'Revert "feat: secret" (#9)', "2026-01-05T10:00:00Z"),
        commit(
          B,
          "fix: undo it\n\nThis reverts commit 0123456789abcdef.",
          "2026-01-05T11:00:00Z",
        ),
        commit(C, "feat: reverting nothing", "2026-01-05T12:00:00Z"),
      ],
    });
    await t.poll();
    const events = (await t.stored()).filter((e) => e.kind === "main.revert");
    expect(events.map((e) => [e.id, e.occurredAt])).toEqual([
      [`github:main.revert:${A}`, "2026-01-05T10:00:00Z"],
      [`github:main.revert:${B}`, "2026-01-05T11:00:00Z"],
    ]);
    expect(JSON.stringify(events)).not.toMatch(/secret/);
  });

  it("does not count a pull request merely titled Revert: only what landed on main", async () => {
    const t = setup({
      "pr list": [
        { number: 9, mergedAt: "2026-01-05T10:00:00Z", title: 'Revert "x"' },
      ],
    });
    await t.poll();
    expect((await t.stored()).filter((e) => e.kind === "main.revert")).toEqual(
      [],
    );
  });

  it("asks for main's commits", async () => {
    const t = setup({});
    await t.poll();
    expect(t.calls.find((c) => c.includes("/commits"))).toContain("sha=main");
  });
});

const comment = (id: number, login: string, at: string, issue = 7) => ({
  id,
  created_at: at,
  issue_url: `https://api.github.com/repos/corekraft/kore/issues/${issue}`,
  user: { login },
  body: "secret",
});
const issueEvent = (id: number, login: string, at: string, number = 8) => ({
  id,
  event: "labeled",
  created_at: at,
  issue: { number },
  actor: { login },
});

describe("pollSignals owner actions", () => {
  it("records only the owner's comments, issue events and pull request reviews, by number and time", async () => {
    const t = setup({
      "issues/comments": [
        comment(1, "junners", "2026-01-05T10:00:00Z"),
        comment(2, "someone-else", "2026-01-05T10:01:00Z"),
      ],
      "issues/events": [
        issueEvent(5, "junners", "2026-01-05T10:02:00Z"),
        issueEvent(6, "claude[bot]", "2026-01-05T10:03:00Z"),
      ],
      "pr list --repo corekraft/kore --state all": [
        {
          number: 12,
          reviews: [
            {
              id: "PRR_a",
              author: { login: "junners" },
              submittedAt: "2026-01-05T10:04:00Z",
              body: "secret",
            },
            {
              id: "PRR_b",
              author: { login: "other" },
              submittedAt: "2026-01-05T10:05:00Z",
            },
          ],
        },
      ],
    });
    await t.poll();
    const events = (await t.stored()).filter((e) => e.kind === "owner.action");
    expect(events.map((e) => [e.number, e.occurredAt])).toEqual([
      [7, "2026-01-05T10:00:00Z"],
      [8, "2026-01-05T10:02:00Z"],
      [12, "2026-01-05T10:04:00Z"],
    ]);
    expect(JSON.stringify(events)).not.toMatch(/secret|junners/);
  });

  const full = (minute: string) =>
    Array.from({ length: 100 }, (_, i) =>
      issueEvent(i + 1, "claude[bot]", `2026-01-05T10:${minute}:00Z`),
    );

  it("refuses to record when more events arrived since the last owner action than it can page through", async () => {
    const t = setup({ "issues/events": full("30") });
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

  it("fails loudly when a first poll hits the page cap, and takes a --since to bound it", async () => {
    const t = setup({ "issues/events": full("30") });
    const first = await t.poll();
    expect(first.ok).toBe(false);
    expect(first.ok ? "" : first.message).toMatch(/--since/);
  });
});
