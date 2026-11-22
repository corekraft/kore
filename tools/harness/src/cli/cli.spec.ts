import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandError } from "../runtime/index.js";
import { run } from "./cli.js";
import { depsOf, outputOf, table } from "./cli-fakes-support.js";

vi.mock("./domains.js", async () => ({
  domains: (await import("./cli-fakes-support.js")).table,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("harness dispatch: resolving the command", () => {
  it("runs a domain's only command when no command name is given", async () => {
    const deps = depsOf();
    expect(await run(["lone"], deps)).toBe(0);
    expect(table.lone[""].run).toHaveBeenCalledTimes(1);
  });

  it("never resolves a prototype member such as constructor as a domain or command", async () => {
    const deps = depsOf();
    expect(await run(["constructor", "x"], deps)).toBe(2);
    expect(await run(["harness", "__proto__"], deps)).toBe(2);
    expect(outputOf().err).toContain('Unknown domain "constructor"');
  });
});

describe("harness dispatch: flags and operands", () => {
  it("passes the parsed flags, operand and --json to the command, and returns its exit code", async () => {
    const deps = depsOf();
    table.plan.tick.run.mockResolvedValueOnce(4);
    const code = await run(
      ["plan", "tick", "A1", "--note", "why", "--force", "--json"],
      deps,
    );
    expect(code).toBe(4);
    expect(table.plan.tick.run.mock.calls).toEqual([
      [
        {
          json: true,
          options: { note: "why", force: true },
          operand: "A1",
          deps,
        },
      ],
    ]);
  });

  it("accepts a value written inline with =, and a value that is itself empty", async () => {
    const deps = depsOf();
    await run(["plan", "tick", "--note=a=b", "--force"], deps);
    expect(table.plan.tick.run.mock.calls.at(-1)?.[0]).toMatchObject({
      options: { note: "a=b", force: true },
    });
  });

  it("refuses an unknown flag, shows usage, and runs nothing", async () => {
    const deps = depsOf();
    expect(await run(["harness", "version", "--bogus"], deps)).toBe(2);
    expect(outputOf().err).toContain('Unknown flag "--bogus"');
    expect(table.harness.version.run).not.toHaveBeenCalled();
  });

  it("refuses a value flag with no value, and a boolean flag given a value", async () => {
    const deps = depsOf();
    expect(await run(["plan", "tick", "A1", "--note"], deps)).toBe(2);
    expect(outputOf().err).toContain('Flag "--note" needs a value.');
    expect(await run(["plan", "tick", "A1", "--force=yes"], deps)).toBe(2);
    expect(outputOf().err).toContain('Flag "--force" takes no value.');
  });

  it("refuses an operand the command does not take, and a second operand", async () => {
    const deps = depsOf();
    expect(await run(["harness", "version", "stray"], deps)).toBe(2);
    expect(outputOf().err).toContain('Unexpected argument "stray".');
    expect(await run(["plan", "tick", "A1", "A2"], deps)).toBe(2);
    expect(outputOf().err).toContain('Unexpected argument "A2".');
  });

  it("asks for a flag placed before the command, and runs nothing", async () => {
    const deps = depsOf();
    expect(await run(["--note", "x", "plan", "tick"], deps)).toBe(2);
    expect(outputOf().err).toContain(
      'Put "--note" after the command: harness <domain> <command> [flags].',
    );
  });
});

describe("harness dispatch: repeatable flags", () => {
  it("collects a repeatable flag into lists, in the order given, and keeps it out of options", async () => {
    const deps = depsOf();
    await run(
      [
        "lone",
        "join",
        "--pr",
        "5",
        "--session",
        "a",
        "--pr=7",
        "--timeout",
        "9",
      ],
      deps,
    );
    expect(table.lone.join.run.mock.calls.at(-1)?.[0]).toEqual({
      json: false,
      options: { timeout: "9" },
      lists: { pr: ["5", "7"], session: ["a"] },
      operand: undefined,
      deps,
    });
  });

  it("omits lists from the context when no repeatable flag is given", async () => {
    const deps = depsOf();
    await run(["lone", "join", "--timeout", "9"], deps);
    expect(table.lone.join.run.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "lists",
    );
  });

  it("refuses a repeatable flag with no value, and runs nothing", async () => {
    const deps = depsOf();
    const before = table.lone.join.run.mock.calls.length;
    expect(await run(["lone", "join", "--pr"], deps)).toBe(2);
    expect(outputOf().err).toContain('Flag "--pr" needs a value.');
    expect(table.lone.join.run.mock.calls.length).toBe(before);
  });
});

describe("harness dispatch: exit codes and failures", () => {
  it("prints a command's expected failure on stderr and exits 1", async () => {
    const deps = depsOf();
    table.harness.version.run.mockRejectedValueOnce(
      new CommandError("the version is missing"),
    );
    expect(await run(["harness", "version"], deps)).toBe(1);
    expect(outputOf().err).toBe("the version is missing\n");
  });

  it("writes a command's expected failure as a JSON line first under --json", async () => {
    const deps = depsOf();
    table.harness.version.run.mockRejectedValueOnce(
      new CommandError("the version is missing"),
    );
    expect(await run(["harness", "version", "--json"], deps)).toBe(1);
    expect(outputOf().err).toBe(
      '{"error":"the version is missing"}\nthe version is missing\n',
    );
  });

  it("rethrows an error that is not a command error, so a bug is never reported as an expected failure", async () => {
    const deps = depsOf();
    const bug = new Error("bug");
    table.harness.version.run.mockRejectedValueOnce(bug);
    await expect(run(["harness", "version"], deps)).rejects.toBe(bug);
    expect(outputOf().err).toBe("");
  });

  it("exits 1, not 2, for a hook, so a typo in settings never blocks a tool call", async () => {
    const deps = depsOf();
    expect(await run(["hook", "nope"], deps)).toBe(1);
    expect(await run(["hook", "guard", "--bogus"], deps)).toBe(1);
  });
});
