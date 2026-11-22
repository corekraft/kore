import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandError, type CliDeps } from "../runtime/index.js";
import { depsWith } from "./command-support.js";
import { run } from "./cli.js";

const table = vi.hoisted(() => {
  const command = (summary: string, extra: Record<string, unknown> = {}) => ({
    summary,
    run: vi.fn((_context: unknown) => Promise.resolve(0)),
    ...extra,
  });
  return {
    harness: { version: command("print the harness version") },
    plan: {
      tick: command("tick a step", {
        operand: "step",
        options: { note: "string", force: "boolean" },
      }),
    },
    hook: { guard: command("guard a tool call") },
    lone: {
      "": command("the domain's only command"),
      join: command("join targets", {
        options: { pr: "list", session: "list", timeout: "string" },
      }),
    },
  };
});

const renderers = vi.hoisted(() => ({
  renderText: vi.fn((view: { level: string }) => `text ${view.level}\n`),
  renderJson: vi.fn((view: { level: string }) => `json ${view.level}\n`),
}));

vi.mock("./domains.js", () => ({ domains: table }));

// The renderers print their view's level, so a spec shows which level the dispatcher chose;
// the views are the real builders over the fake table.
vi.mock("../help/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../help/index.js")>()),
  renderText: renderers.renderText,
  renderJson: renderers.renderJson,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// The output of the most recent depsOf(): what its stdout and stderr received.
let captured = { out: "", err: "" };

/** A throwing stand-in: a dispatch touches none of these, since a help request reads no root, file, process or clock. */
function untouched(what: string): () => never {
  return () => {
    throw new Error(`a dispatch touched ${what}`);
  };
}

function depsOf(): CliDeps {
  captured = { out: "", err: "" };
  return depsWith({
    root: untouched("the repository root"),
    runner: { run: untouched("the runner") },
    clock: { now: untouched("the clock"), sleep: untouched("the clock") },
    fs: new Proxy({}, { get: untouched("the file system") }),
    stdout: (text: string) => (captured.out += text),
    stderr: (text: string) => (captured.err += text),
  });
}

function outputOf() {
  return captured;
}

describe("harness dispatch: help at the three levels", () => {
  it.each([[[]], [["--help"]], [["-h"]]])(
    "prints the root guide to stdout for %j, exits 0 and touches nothing",
    async (argv) => {
      const deps = depsOf();
      expect(await run(argv, deps)).toBe(0);
      expect(outputOf()).toEqual({ out: "text root\n", err: "" });
      expect(renderers.renderText).toHaveBeenLastCalledWith(
        expect.objectContaining({ level: "root" }),
      );
    },
  );

  it("renders a domain's guide for <domain> --help, and a command's for <domain> <command> --help", async () => {
    const domain = depsOf();
    expect(await run(["plan", "--help"], domain)).toBe(0);
    expect(outputOf()).toEqual({ out: "text domain\n", err: "" });
    const command = depsOf();
    expect(await run(["plan", "tick", "--help"], command)).toBe(0);
    expect(outputOf()).toEqual({ out: "text command\n", err: "" });
    expect(renderers.renderText).toHaveBeenLastCalledWith(
      expect.objectContaining({ level: "command", path: "plan tick" }),
    );
  });

  it("collapses a domain whose only command is unnamed, so its --help renders that command's guide", async () => {
    const deps = depsOf();
    expect(await run(["lone", "--help"], deps)).toBe(0);
    expect(outputOf().out).toBe("text command\n");
    expect(renderers.renderText).toHaveBeenLastCalledWith(
      expect.objectContaining({ level: "command", path: "lone" }),
    );
  });

  it("lets --help and -h win over every other flag and operand on the line, and runs no command", async () => {
    const deps = depsOf();
    expect(
      await run(
        ["plan", "tick", "A1", "--note", "why", "--force", "--help"],
        deps,
      ),
    ).toBe(0);
    expect(await run(["plan", "tick", "--bogus", "-h"], deps)).toBe(0);
    expect(table.plan.tick.run).not.toHaveBeenCalled();
    expect(outputOf().err).toBe("");
  });

  it("prints the same level as one JSON object under --help --json, and no prose", async () => {
    const deps = depsOf();
    expect(await run(["plan", "tick", "--help", "--json"], deps)).toBe(0);
    expect(outputOf()).toEqual({ out: "json command\n", err: "" });
    expect(renderers.renderText).not.toHaveBeenCalled();
  });
});

describe("harness dispatch: a usage error prints the guide of the closest level", () => {
  it("prints the root guide after an unknown domain's error, with exit 2 and nothing on stdout", async () => {
    const deps = depsOf();
    expect(await run(["nope", "x"], deps)).toBe(2);
    expect(outputOf()).toEqual({
      out: "",
      err: 'Unknown domain "nope". Domains: harness, plan, hook, lone.\n\ntext root\n',
    });
  });

  it("prints the domain's guide after an unknown command, and after a missing one", async () => {
    const unknown = depsOf();
    expect(await run(["harness", "nope"], unknown)).toBe(2);
    expect(outputOf().err).toBe(
      'Unknown command "nope" for domain "harness". Commands: version.\n\ntext domain\n',
    );
    const missing = depsOf();
    expect(await run(["plan"], missing)).toBe(2);
    expect(outputOf().err).toBe(
      'Missing command for domain "plan". Commands: tick.\n\ntext domain\n',
    );
  });

  it("prints the command's guide after a flag error, and after an operand error", async () => {
    const flag = depsOf();
    expect(await run(["plan", "tick", "A1", "--bogus"], flag)).toBe(2);
    expect(outputOf().err).toBe('Unknown flag "--bogus".\n\ntext command\n');
    const operand = depsOf();
    expect(await run(["harness", "version", "stray"], operand)).toBe(2);
    expect(outputOf().err).toBe(
      'Unexpected argument "stray".\n\ntext command\n',
    );
  });

  it("prints the JSON error object first under --json, then the same prose guide", async () => {
    const deps = depsOf();
    expect(await run(["plan", "tick", "--bogus", "--json"], deps)).toBe(2);
    const message = 'Unknown flag "--bogus".';
    expect(outputOf().err).toBe(
      JSON.stringify({ error: message }) +
        "\n" +
        message +
        "\n\ntext command\n",
    );
  });
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
