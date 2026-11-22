import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandError } from "../runtime/index.js";
import { run } from "./cli.js";
import { depsOf, help, outputOf, table } from "./cli-fakes-support.js";

vi.mock("./domains.js", async () => ({
  domains: (await import("./cli-fakes-support.js")).table,
}));

// The help renderers and view builders are mocked, so each usage error shows the level its guide was rendered at.
vi.mock("../help/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../help/index.js")>()),
  ...(await import("./cli-fakes-support.js")).help,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Runs argv and asserts it exits with the code, prints only the error line, then renders the one
 * guide of the closest level.
 */
async function refused(
  argv: string[],
  message: string,
  level: string,
  code = 2,
): Promise<void> {
  const deps = depsOf();
  help.renderText.mockClear();
  expect(await run(argv, deps)).toBe(code);
  expect(outputOf()).toEqual({
    out: "",
    err: `${message}\n\ntext ${level}\n`,
  });
  expect(help.renderText).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ level }),
  );
}

describe("harness dispatch: resolving the command", () => {
  it("runs a domain's only command when no command name is given", async () => {
    const deps = depsOf();
    expect(await run(["lone"], deps)).toBe(0);
    expect(table.lone[""].run).toHaveBeenCalledTimes(1);
  });

  it("never resolves a prototype member such as constructor as a domain or command", async () => {
    await refused(
      ["constructor", "x"],
      'Unknown domain "constructor".',
      "root",
    );
    await refused(
      ["harness", "__proto__"],
      'Unknown command "__proto__" for domain "harness".',
      "domain",
    );
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
});

describe("harness dispatch: refused words run nothing", () => {
  it("refuses an unknown flag, shows the command's guide, and runs nothing", async () => {
    await refused(
      ["harness", "version", "--bogus"],
      'Unknown flag "--bogus".',
      "command",
    );
    expect(table.harness.version.run).not.toHaveBeenCalled();
  });

  it("refuses a value flag with no value, and a boolean flag given a value", async () => {
    await refused(
      ["plan", "tick", "A1", "--note"],
      'Flag "--note" needs a value.',
      "command",
    );
    await refused(
      ["plan", "tick", "A1", "--force=yes"],
      'Flag "--force" takes no value.',
      "command",
    );
  });

  it("refuses an operand the command does not take, and a second operand", async () => {
    await refused(
      ["harness", "version", "stray"],
      'Unexpected argument "stray".',
      "command",
    );
    await refused(
      ["plan", "tick", "A1", "A2"],
      'Unexpected argument "A2".',
      "command",
    );
  });

  it("asks for a flag placed before the command, with the root guide, and runs nothing", async () => {
    await refused(
      ["--note", "x", "plan", "tick"],
      'Put "--note" after the command: harness <domain> <command> [flags].',
      "root",
    );
  });

  it("refuses a repeatable flag with no value, and runs nothing", async () => {
    await refused(
      ["lone", "join", "--pr"],
      'Flag "--pr" needs a value.',
      "command",
    );
    expect(table.lone.join.run).not.toHaveBeenCalled();
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
    await refused(
      ["hook", "nope"],
      'Unknown command "nope" for domain "hook".',
      "domain",
      1,
    );
    await refused(
      ["hook", "guard", "--bogus"],
      'Unknown flag "--bogus".',
      "command",
      1,
    );
  });
});
