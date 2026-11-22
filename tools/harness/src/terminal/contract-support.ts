import { describe, expect, it } from "vitest";
import type {
  Terminal,
  Terminals,
  TerminalError,
  TerminalErrorKind,
} from "./port.js";

// The stateful Terminals contract (plan 16, Step 2). Every backend runs it: the
// fake in unit tests, and the real hc backend in the integration tier. It
// asserts on the port's observable outcomes only, never on message text or ids.

/** A backend under test, plus the two ways a test drives its programs. */
export interface ContractSubject {
  terminals: Terminals;
  /** A directory that exists, for a terminal to start in. */
  dir: string;
  /** Prints text to a terminal's output, as its program would. The call returns once the text is there. */
  emit: (id: string, text: string) => void | Promise<void>;
  /** Ends a terminal's program with an exit code, as the program exiting would. The call returns once it has ended. */
  finish: (id: string, exitCode: number) => void | Promise<void>;
}

/** A shell is the one program every backend runs, so the contract starts one for every terminal. */
const PROGRAM = ["sh"];

type Make = () => ContractSubject | Promise<ContractSubject>;

function isError(value: unknown): value is TerminalError {
  return typeof value === "object" && value !== null && "error" in value;
}

/** The result, or a failing test that names the error it was given instead. */
export function ok<T>(result: T | TerminalError): T {
  if (isError(result)) {
    throw new Error(
      `expected a result, got ${result.error.kind}: ${result.error.message}`,
    );
  }
  return result;
}

function expectKind(result: unknown, kind: TerminalErrorKind): void {
  expect(result).toMatchObject({ error: { kind } });
}

function idsOf(terminals: readonly Terminal[]): string[] {
  return terminals.map((terminal) => terminal.id).sort();
}

function runsAndGets(make: Make): void {
  it("run starts a live terminal that get reports with its name, cwd and labels", async () => {
    const { terminals, dir } = await make();
    const { id } = ok(
      await terminals.run({
        argv: PROGRAM,
        name: "alpha",
        cwd: dir,
        labels: { role: "writer" },
      }),
    );
    expect(ok(await terminals.get(id))).toEqual({
      id,
      name: "alpha",
      state: "live",
      cwd: dir,
      labels: { role: "writer" },
    });
  });

  it("get of an unknown terminal is not-found", async () => {
    const { terminals } = await make();
    expectKind(await terminals.get("no-such-terminal"), "not-found");
  });

  it("run refuses a name a live terminal holds, and allows it once that terminal finished", async () => {
    const { terminals, finish, dir } = await make();
    const first = ok(
      await terminals.run({ argv: PROGRAM, name: "alpha", cwd: dir }),
    );
    expectKind(
      await terminals.run({ argv: PROGRAM, name: "alpha", cwd: dir }),
      "name-taken",
    );
    await finish(first.id, 0);
    expect(
      "error" in
        (await terminals.run({ argv: PROGRAM, name: "alpha", cwd: dir })),
    ).toBe(false);
  });

  it("run with an unknown parent is not-found, and with a finished parent is not-live", async () => {
    const { terminals, finish, dir } = await make();
    expectKind(
      await terminals.run({
        argv: PROGRAM,
        cwd: dir,
        parent: "no-such-terminal",
      }),
      "not-found",
    );
    const parent = ok(await terminals.run({ argv: PROGRAM, cwd: dir }));
    await finish(parent.id, 0);
    expectKind(
      await terminals.run({ argv: PROGRAM, cwd: dir, parent: parent.id }),
      "not-live",
    );
  });
}

function waitsAndEnds(make: Make): void {
  it("wait with a 0 ms timeout is a timeout for a live terminal, and finished ones are returned at once", async () => {
    const { terminals, finish, dir } = await make();
    const { id } = ok(await terminals.run({ argv: PROGRAM, cwd: dir }));
    expectKind(await terminals.wait({ terminal: id }, 0), "timeout");
    await finish(id, 3);
    expect(ok(await terminals.wait({ terminal: id }, 0))).toEqual({
      finished: [{ id, state: "finished", exitCode: 3, labels: {}, cwd: dir }],
    });
  });

  it("a pending wait resolves with the terminal when it finishes", async () => {
    const { terminals, finish, dir } = await make();
    const { id } = ok(await terminals.run({ argv: PROGRAM, cwd: dir }));
    const waiting = terminals.wait({ terminal: id }, 60_000);
    await finish(id, 0);
    expect(ok(await waiting)).toEqual({
      finished: [{ id, state: "finished", exitCode: 0, labels: {}, cwd: dir }],
    });
  });

  it("read returns the output printed so far, with at least the last lines asked for", async () => {
    const { terminals, emit, dir } = await make();
    const { id } = ok(await terminals.run({ argv: PROGRAM, cwd: dir }));
    await emit(id, "one\ntwo\nthree\n");
    expect(ok(await terminals.read(id, 2)).text).toContain("two\nthree");
    expect(ok(await terminals.read(id, 5)).text).toContain("one\ntwo\nthree");
  });

  it("kill ends a live terminal, and remove deletes only a finished one", async () => {
    const { terminals, dir } = await make();
    const { id } = ok(await terminals.run({ argv: PROGRAM, cwd: dir }));
    expectKind(await terminals.remove(id), "still-live");
    ok(await terminals.kill(id));
    expect(ok(await terminals.get(id))).toMatchObject({
      id,
      state: "finished",
    });
    ok(await terminals.remove(id));
    expectKind(await terminals.get(id), "not-found");
  });
}

function parentsAndLabels(make: Make): void {
  it("a child ends with its parent unless it outlives it, and list finds children by parent", async () => {
    const { terminals, finish, dir } = await make();
    const parent = ok(await terminals.run({ argv: PROGRAM, cwd: dir })).id;
    const child = ok(
      await terminals.run({ argv: PROGRAM, cwd: dir, parent }),
    ).id;
    const orphan = ok(
      await terminals.run({
        argv: PROGRAM,
        cwd: dir,
        parent,
        outliveParent: true,
      }),
    ).id;
    expect(ok(await terminals.get(child))).toMatchObject({ parent });
    expect(idsOf(ok(await terminals.list({ childrenOf: parent })))).toEqual(
      [child, orphan].sort(),
    );
    await finish(parent, 0);
    expect(ok(await terminals.get(child))).toMatchObject({ state: "finished" });
    expect(ok(await terminals.get(orphan))).toMatchObject({ state: "live" });
  });

  it("wait on children resolves for any one finished child, or for all of them", async () => {
    const { terminals, finish, dir } = await make();
    const parent = ok(await terminals.run({ argv: PROGRAM, cwd: dir })).id;
    const a = ok(await terminals.run({ argv: PROGRAM, cwd: dir, parent })).id;
    const b = ok(await terminals.run({ argv: PROGRAM, cwd: dir, parent })).id;
    const news = terminals.wait({ children: "any", of: parent }, 60_000);
    await finish(a, 0);
    expect(idsOf(ok(await news).finished)).toEqual([a]);
    expectKind(
      await terminals.wait({ children: "all", of: parent }, 0),
      "timeout",
    );
    await finish(b, 0);
    expect(
      idsOf(
        ok(await terminals.wait({ children: "all", of: parent }, 0)).finished,
      ),
    ).toEqual([a, b].sort());
  });
}

function labelsAndFilters(make: Make): void {
  it("list filters by labels, and label merges new labels into the ones a terminal has", async () => {
    const { terminals, dir } = await make();
    const writer = ok(
      await terminals.run({
        argv: PROGRAM,
        cwd: dir,
        labels: { role: "writer", group: "pair" },
      }),
    ).id;
    const reviewer = ok(
      await terminals.run({
        argv: PROGRAM,
        cwd: dir,
        labels: { role: "reviewer", group: "pair" },
      }),
    ).id;
    expect(
      idsOf(ok(await terminals.list({ labels: { group: "pair" } }))),
    ).toEqual([writer, reviewer].sort());
    expect(
      idsOf(ok(await terminals.list({ labels: { role: "writer" } }))),
    ).toEqual([writer]);
    ok(await terminals.label(writer, { model: "sonnet" }));
    expect(ok(await terminals.get(writer))).toMatchObject({
      labels: { role: "writer", group: "pair", model: "sonnet" },
    });
    expect(ok(await terminals.list({ labels: { role: "writer" } }))).toEqual([
      expect.objectContaining({
        id: writer,
        labels: { role: "writer", group: "pair", model: "sonnet" },
      }),
    ]);
  });
}

/** The whole stateful contract: every backend runs it, each case on a fresh subject. */
export function terminalContract(make: Make): void {
  describe("the Terminals contract", () => {
    describe("run, get and names", () => runsAndGets(make));
    describe("wait, read and end", () => waitsAndEnds(make));
    describe("parents and children", () => parentsAndLabels(make));
    describe("labels", () => labelsAndFilters(make));
  });
}
