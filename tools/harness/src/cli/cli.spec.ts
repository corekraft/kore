import { describe, expect, it, vi } from "vitest";
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
    lone: { "": command("the domain's only command") },
  };
});

vi.mock("./domains.js", () => ({ domains: table }));

// The output of the most recent depsOf(): what its stdout and stderr received.
let captured = { out: "", err: "" };

function depsOf(): CliDeps {
  captured = { out: "", err: "" };
  return depsWith({
    stdout: (text: string) => {
      captured.out += text;
    },
    stderr: (text: string) => {
      captured.err += text;
    },
  });
}

function outputOf() {
  return captured;
}

describe("harness dispatch: usage", () => {
  it.each([[["--help"]], [["-h"]], [[]]])(
    "prints the usage listing every domain's commands for %j and exits 0",
    async (argv) => {
      const deps = depsOf();
      expect(await run(argv, deps)).toBe(0);
      const { out, err } = outputOf();
      expect(out).toContain("Usage: harness <domain> <command> [--json]");
      expect(out).toContain(
        "  harness harness version  print the harness version",
      );
      expect(out).toContain("  harness plan tick  tick a step");
      expect(out).toContain("  harness hook guard  guard a tool call");
      expect(err).toBe("");
    },
  );

  it("shows only the domain's commands for `<domain> --help` and exits 0", async () => {
    const deps = depsOf();
    expect(await run(["plan", "--help"], deps)).toBe(0);
    expect(outputOf().out).toContain("tick a step");
  });

  it("rejects an unknown domain, names the known ones, and shows usage with exit 2", async () => {
    const deps = depsOf();
    expect(await run(["nope", "x"], deps)).toBe(2);
    const { out, err } = outputOf();
    expect(err).toContain(
      'Unknown domain "nope". Domains: harness, plan, hook, lone.',
    );
    expect(err).toContain("Usage: harness");
    expect(out).toBe("");
  });
});

describe("harness dispatch: resolving the command", () => {
  it("rejects an unknown command and lists the domain's commands", async () => {
    const deps = depsOf();
    expect(await run(["harness", "nope"], deps)).toBe(2);
    expect(outputOf().err).toContain(
      'Unknown command "nope" for domain "harness". Commands: version.',
    );
  });

  it("rejects a domain without a command when it has several", async () => {
    const deps = depsOf();
    expect(await run(["plan"], deps)).toBe(2);
    expect(outputOf().err).toContain(
      'Missing command for domain "plan". Commands: tick.',
    );
  });

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
