import { describe, expect, it } from "vitest";
import { ok, terminalContract } from "./contract-support.js";
import { FakeTerminals } from "./FakeTerminals.js";
import type { TerminalEvent } from "./port.js";

async function collect(
  events: AsyncIterable<TerminalEvent>,
): Promise<TerminalEvent[]> {
  const seen: TerminalEvent[] = [];
  for await (const event of events) {
    seen.push(event);
  }
  return seen;
}

describe("FakeTerminals", () => {
  terminalContract(() => {
    const fake = new FakeTerminals();
    return {
      terminals: fake,
      emit: (id, text) => fake.emit(id, text),
      finish: (id, exitCode) => fake.finish(id, exitCode),
    };
  });
});

describe("FakeTerminals on its own", () => {
  it("self returns the id it was built with, and undefined when it was built with none", () => {
    expect(new FakeTerminals({ self: "t7" }).self()).toBe("t7");
    expect(new FakeTerminals().self()).toBeUndefined();
  });

  it("events replays what happened in order, and filters by terminal", async () => {
    const fake = new FakeTerminals();
    const a = ok(await fake.run({ argv: ["a"], cwd: "/w" })).id;
    const b = ok(await fake.run({ argv: ["b"], cwd: "/w" })).id;
    ok(await fake.label(a, { role: "writer" }));
    fake.finish(a, 0);
    ok(await fake.remove(a));
    expect(await collect(fake.events())).toEqual([
      { kind: "started", terminal: a },
      { kind: "started", terminal: b },
      { kind: "labelled", terminal: a },
      { kind: "finished", terminal: a },
      { kind: "removed", terminal: a },
    ]);
    expect(await collect(fake.events({ terminal: b }))).toEqual([
      { kind: "started", terminal: b },
    ]);
  });
});

describe("FakeTerminals control and send", () => {
  it("interrupt is ok for a live terminal and not-live for a finished one", async () => {
    const fake = new FakeTerminals();
    const id = ok(await fake.run({ argv: ["i"], cwd: "/w" })).id;
    expect(ok(await fake.interrupt(id))).toEqual({ id });
    fake.finish(id, 0);
    expect(await fake.interrupt(id)).toMatchObject({
      error: { kind: "not-live" },
    });
  });

  it("send records the text of a live terminal, and refuses a finished one or a status it is not in", async () => {
    const fake = new FakeTerminals();
    const id = ok(await fake.run({ argv: ["s"], cwd: "/w" })).id;
    expect(ok(await fake.send(id, "go\n"))).toEqual({ id });
    expect(fake.sent(id)).toEqual(["go\n"]);
    fake.setStatus(id, "working");
    expect(await fake.send(id, "again\n", { ifStatus: "idle" })).toMatchObject({
      error: { kind: "status-mismatch" },
    });
    expect(fake.sent(id)).toEqual(["go\n"]);
    fake.setStatus(id, "idle");
    expect(ok(await fake.send(id, "again\n", { ifStatus: "idle" }))).toEqual({
      id,
    });
    expect(ok(await fake.get(id))).toMatchObject({ status: "idle" });
    fake.finish(id, 0);
    expect(await fake.send(id, "late\n")).toMatchObject({
      error: { kind: "not-live" },
    });
    expect(fake.sent(id)).toEqual(["go\n", "again\n"]);
  });

  it("a control call on an unknown terminal throws, so a test that names a wrong id fails loudly", () => {
    const fake = new FakeTerminals();
    expect(() => fake.emit("no-such-terminal", "x")).toThrow(
      "no terminal no-such-terminal",
    );
    expect(() => fake.finish("no-such-terminal", 0)).toThrow(
      "no terminal no-such-terminal",
    );
    expect(() => fake.setStatus("no-such-terminal", "idle")).toThrow(
      "no terminal no-such-terminal",
    );
  });
});
