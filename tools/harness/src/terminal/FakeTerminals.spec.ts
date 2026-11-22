import { describe, expect, it, vi } from "vitest";
import { ok, terminalContract } from "./contract-support.js";
import { FakeTerminals } from "./FakeTerminals.js";
import type { TerminalEvent } from "./port.js";

// terminalError is the port's behaving error builder, so the fake's spec mocks it.
// Its real output is covered by port.spec.ts; the mock keeps the same shape.
vi.mock("./port.js", () => ({
  terminalError: vi.fn((kind: string, message: string, hint?: string) =>
    hint === undefined
      ? { error: { kind, message } }
      : { error: { kind, message, hint } },
  ),
}));

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
      dir: "/w",
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

  it("a child cannot start under a parent that has finished, and says what to do instead", async () => {
    const fake = new FakeTerminals();
    const parent = ok(await fake.run({ argv: ["p"], cwd: "/w" })).id;
    fake.finish(parent, 0);
    expect(await fake.run({ argv: ["c"], cwd: "/w", parent })).toEqual({
      error: {
        kind: "not-live",
        message: `terminal ${parent} has finished`,
        hint: "start the child under a live parent",
      },
    });
  });
});

describe("FakeTerminals control and send", () => {
  it("interrupt is ok for a live terminal, and not-live with a hint for a finished one", async () => {
    const fake = new FakeTerminals();
    const id = ok(await fake.run({ argv: ["i"], cwd: "/w" })).id;
    expect(ok(await fake.interrupt(id))).toEqual({ id });
    fake.finish(id, 0);
    expect(await fake.interrupt(id)).toEqual({
      error: {
        kind: "not-live",
        message: `terminal ${id} has finished`,
        hint: "a finished terminal takes no signals; start a new one",
      },
    });
  });

  it("send records the text of a live terminal", async () => {
    const fake = new FakeTerminals();
    const id = ok(await fake.run({ argv: ["s"], cwd: "/w" })).id;
    expect(ok(await fake.send(id, "go\n"))).toEqual({ id });
    expect(fake.sent(id)).toEqual(["go\n"]);
  });

  it("send names the status it is not in, with a hint, and records nothing", async () => {
    const fake = new FakeTerminals();
    const id = ok(await fake.run({ argv: ["s"], cwd: "/w" })).id;
    fake.setStatus(id, "working");
    expect(await fake.send(id, "again\n", { ifStatus: "idle" })).toEqual({
      error: {
        kind: "status-mismatch",
        message: `terminal ${id} is working, not idle`,
        hint: "wait until the terminal reports the status you named, then send",
      },
    });
    expect(fake.sent(id)).toEqual([]);
  });

  it("send to a finished terminal is not-live with a hint, and records nothing", async () => {
    const fake = new FakeTerminals();
    const id = ok(await fake.run({ argv: ["s"], cwd: "/w" })).id;
    fake.setStatus(id, "idle");
    expect(ok(await fake.send(id, "go\n", { ifStatus: "idle" }))).toEqual({
      id,
    });
    expect(ok(await fake.get(id))).toMatchObject({ status: "idle" });
    fake.finish(id, 0);
    expect(await fake.send(id, "late\n")).toEqual({
      error: {
        kind: "not-live",
        message: `terminal ${id} has finished`,
        hint: "a finished terminal takes no input; start a new one",
      },
    });
    expect(fake.sent(id)).toEqual(["go\n"]);
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

describe("FakeTerminals: events follow the port's filters", () => {
  it("follows only the events of terminals carrying every label given", async () => {
    const fake = new FakeTerminals();
    const mine = (await fake.run({
      argv: ["a"],
      cwd: "/w",
      labels: { "kore-session": "s1" },
    })) as { id: string };
    const other = (await fake.run({
      argv: ["b"],
      cwd: "/w",
      labels: { "kore-session": "s2" },
    })) as { id: string };
    fake.finish(other.id, 0);
    expect(
      await collect(fake.events({ labels: { "kore-session": "s1" } })),
    ).toEqual([{ kind: "started", terminal: mine.id }]);
  });

  it("reports a status change as changed, so a follow sees what hc would report", async () => {
    const fake = new FakeTerminals();
    const started = (await fake.run({ argv: ["a"], cwd: "/w" })) as {
      id: string;
    };
    fake.setStatus(started.id, "working");
    expect(await collect(fake.events({ terminal: started.id }))).toEqual([
      { kind: "started", terminal: started.id },
      { kind: "changed", terminal: started.id },
    ]);
  });
});
