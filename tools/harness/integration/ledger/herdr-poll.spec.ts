import { describe, expect, it } from "vitest";
import { setup, writer } from "./herdr-poll-support.js";

describe("pollHerdr transitions", () => {
  it("records a pane first seen as spawned, then its current status", async () => {
    const t = setup();
    t.show([writer("working")]);
    const result = await t.poll();
    expect(result).toMatchObject({ ok: true, recorded: 2 });
    expect(await t.kinds()).toEqual([
      "pane.spawned:w3:p74",
      "pane.busy:w3:p74",
    ]);
  });

  it("records an idle pane first seen as spawned then waiting", async () => {
    const t = setup();
    t.show([writer("idle")]);
    await t.poll();
    expect(await t.kinds()).toEqual([
      "pane.spawned:w3:p74",
      "pane.waiting:w3:p74",
    ]);
  });

  it("records busy when a waiting pane starts working", async () => {
    const t = setup();
    t.show([writer("idle")]);
    await t.poll();
    t.show([writer("working")]);
    await t.poll();
    expect((await t.kinds()).at(-1)).toBe("pane.busy:w3:p74");
  });

  it("records waiting when a working pane goes idle or blocked on input", async () => {
    const t = setup();
    t.show([writer("working")]);
    await t.poll();
    t.show([writer("blocked")]);
    await t.poll();
    expect((await t.kinds()).at(-1)).toBe("pane.waiting:w3:p74");
  });

  it("records closed when a recorded pane is gone", async () => {
    const t = setup();
    t.show([writer("working")]);
    await t.poll();
    t.show([]);
    const result = await t.poll();
    expect(result).toMatchObject({ ok: true, recorded: 1 });
    expect((await t.kinds()).at(-1)).toBe("pane.closed:w3:p74");
  });

  it("records spawned again when a closed pane id comes back", async () => {
    const t = setup();
    t.show([writer("working")]);
    await t.poll();
    t.show([]);
    await t.poll();
    t.show([writer("idle")]);
    await t.poll();
    expect((await t.kinds()).slice(-2)).toEqual([
      "pane.spawned:w3:p74",
      "pane.waiting:w3:p74",
    ]);
  });
});

describe("pollHerdr idempotence and attribution", () => {
  it("appends nothing when nothing changed", async () => {
    const t = setup();
    t.show([writer("working")]);
    await t.poll();
    const before = (await t.ledger.list({})).events.length;
    const result = await t.poll();
    expect(result).toMatchObject({ ok: true, recorded: 0 });
    expect((await t.ledger.list({})).events).toHaveLength(before);
  });

  it("is idempotent across repeated polls of the same state", async () => {
    const t = setup();
    t.show([writer("idle")]);
    for (let i = 0; i < 3; i++) {
      await t.poll();
    }
    t.show([]);
    for (let i = 0; i < 3; i++) {
      await t.poll();
    }
    expect(await t.kinds()).toEqual([
      "pane.spawned:w3:p74",
      "pane.waiting:w3:p74",
      "pane.closed:w3:p74",
    ]);
  });

  it("attributes every event to the agent name and pane id", async () => {
    const t = setup();
    t.show([writer("working")]);
    await t.poll();
    t.show([]);
    await t.poll();
    const { events } = await t.ledger.list({});
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event).toMatchObject({
        source: "herdr",
        agent: "ledger-poll-herdr-writer",
        pane: "w3:p74",
      });
    }
  });

  it("falls back to the agent type when the agent has no name", async () => {
    const t = setup();
    t.show([{ pane_id: "w2:p7", agent_status: "idle", agent: "claude" }]);
    await t.poll();
    const { events } = await t.ledger.list({});
    expect(events.every((e) => e.agent === "claude")).toBe(true);
  });

  it("keeps when it was observed apart from when it was recorded", async () => {
    const t = setup();
    t.show([writer("working")]);
    await t.poll();
    const { events } = await t.ledger.list({});
    const [spawned, busy] = events;
    // Both events were observed by the same poll, before either was written.
    expect(spawned?.occurredAt).toBe(busy?.occurredAt);
    expect(Date.parse(spawned?.recordedAt ?? "")).toBeGreaterThan(
      Date.parse(spawned?.occurredAt ?? ""),
    );
    expect(Date.parse(busy?.recordedAt ?? "")).toBeGreaterThan(
      Date.parse(spawned?.recordedAt ?? ""),
    );
  });
});

describe("pollHerdr inputs and failures", () => {
  it("tracks several panes independently", async () => {
    const t = setup();
    t.show([
      writer("working"),
      { pane_id: "w3:p75", agent_status: "idle", name: "other" },
    ]);
    await t.poll();
    t.show([writer("working")]);
    await t.poll();
    expect(await t.kinds()).toEqual([
      "pane.spawned:w3:p74",
      "pane.busy:w3:p74",
      "pane.spawned:w3:p75",
      "pane.waiting:w3:p75",
      "pane.closed:w3:p75",
    ]);
  });

  it("ignores panes with an unknown status", async () => {
    const t = setup();
    t.show([{ pane_id: "w3:p2", agent_status: "unknown" }]);
    const result = await t.poll();
    expect(result).toMatchObject({ ok: true, recorded: 0 });
  });

  it("does not close or respawn a recorded pane whose status turns unknown", async () => {
    const t = setup();
    t.show([writer("working")]);
    await t.poll();
    t.show([{ ...writer("unknown") }]);
    expect(await t.poll()).toMatchObject({ ok: true, recorded: 0 });
    t.show([writer("working")]);
    expect(await t.poll()).toMatchObject({ ok: true, recorded: 0 });
    expect(await t.kinds()).toEqual([
      "pane.spawned:w3:p74",
      "pane.busy:w3:p74",
    ]);
  });

  it("reads herdr through the runner and never mutates it", async () => {
    const t = setup();
    await t.poll();
    expect(t.runner.calls.map((c) => [c.command, ...c.args])).toEqual([
      ["herdr", "agent", "list"],
    ]);
  });

  it("fails without writing when herdr fails", async () => {
    const t = setup();
    t.answer.code = 1;
    t.answer.stderr = "server not running";
    const result = await t.poll();
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining("server not running"),
    });
    expect((await t.ledger.list({})).events).toEqual([]);
  });

  it("fails without writing when herdr prints something unreadable", async () => {
    const t = setup();
    t.answer.stdout = "not json";
    const result = await t.poll();
    expect(result.ok).toBe(false);
    t.answer.stdout = JSON.stringify({ result: {} });
    expect((await t.poll()).ok).toBe(false);
    expect((await t.ledger.list({})).events).toEqual([]);
  });
});
