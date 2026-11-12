import { describe, expect, it } from "vitest";
import { PATH, setup, writer } from "./herdr-poll-support.js";

const LOCK = `${PATH}.lock`;

describe("pollHerdr agent names", () => {
  it("falls back to the agent type when the name fails the ledger rule, and keeps recording later panes", async () => {
    const t = setup();
    t.show([
      { ...writer("working"), name: "my writer" },
      { pane_id: "w3:p75", agent_status: "idle", name: "other" },
    ]);
    const result = await t.poll();
    expect(result.ok).toBe(true);
    const { events } = await t.ledger.list({});
    expect(
      events.filter((e) => e.pane === "w3:p74").map((e) => e.agent),
    ).toEqual(["claude", "claude"]);
    expect(events.some((e) => e.pane === "w3:p75")).toBe(true);
  });

  it("uses unknown when neither the name nor the agent type is a valid name", async () => {
    const t = setup();
    t.show([{ ...writer("idle"), name: "my writer", agent: "bad agent!" }]);
    expect((await t.poll()).ok).toBe(true);
    const { events } = await t.ledger.list({});
    expect(events.every((e) => e.agent === "unknown")).toBe(true);
  });
});

describe("pollHerdr agent changes", () => {
  it("closes the old agent and spawns the new one when a recorded pane changes agent", async () => {
    const t = setup();
    t.show([writer("working")]);
    await t.poll();
    t.show([{ ...writer("idle"), name: "second", agent: "codex" }]);
    await t.poll();
    const { events } = await t.ledger.list({});
    expect(events.slice(2).map((e) => [e.kind, e.agent])).toEqual([
      ["pane.closed", "ledger-poll-herdr-writer"],
      ["pane.spawned", "second"],
      ["pane.waiting", "second"],
    ]);
  });

  it("appends nothing when the agent is unchanged", async () => {
    const t = setup();
    t.show([writer("working")]);
    await t.poll();
    expect(await t.poll()).toMatchObject({ ok: true, recorded: 0 });
  });
});

describe("pollHerdr lock", () => {
  it("holds a lock beside the ledger during the poll and removes it after", async () => {
    const t = setup();
    t.show([writer("working")]);
    let during: boolean | undefined;
    const original = t.runner.run.bind(t.runner);
    t.runner.run = async (...args) => {
      during = t.fs.files.has(LOCK);
      return await original(...args);
    };
    await t.poll();
    expect(during).toBe(true);
    expect(t.fs.files.has(LOCK)).toBe(false);
  });

  it("removes the lock after a herdr failure", async () => {
    const t = setup();
    t.answer.code = 1;
    await t.poll();
    expect(t.fs.files.has(LOCK)).toBe(false);
  });

  it("refuses to poll while a fresh lock is held, touching nothing", async () => {
    const t = setup();
    t.fs.files.set(LOCK, "2026-01-02T03:00:00.000Z");
    const result = await t.poll();
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining(LOCK),
    });
    expect(t.runner.calls).toEqual([]);
    expect(t.fs.files.get(LOCK)).toBe("2026-01-02T03:00:00.000Z");
  });

  it("takes over a stale or unreadable lock", async () => {
    for (const content of ["2025-12-31T00:00:00.000Z", "garbage", ""]) {
      const t = setup();
      t.show([writer("working")]);
      t.fs.files.set(LOCK, content);
      expect(await t.poll()).toMatchObject({ ok: true, recorded: 2 });
      expect(t.fs.files.has(LOCK)).toBe(false);
    }
  });

  it("never duplicates transitions when two polls run at once", async () => {
    const t = setup();
    t.show([writer("working")]);
    const results = await Promise.all([t.poll(), t.poll()]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await t.kinds()).toEqual([
      "pane.spawned:w3:p74",
      "pane.busy:w3:p74",
    ]);
  });
});
