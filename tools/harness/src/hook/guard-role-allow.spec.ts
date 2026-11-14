import { describe, expect, it, vi } from "vitest";
import { readMayRun } from "./guard-role-allow.js";

// commandOf, harnessAllowed and bareAssignment are collaborators outside the unit: typed stubs
// stand in for them. Constants (HARNESS) stay real, as ADR 0098 allows.
vi.mock("./guard-shell.js", () => ({
  commandOf: (tokens: readonly string[]) => ({
    name: tokens[0] ?? "",
    args: tokens.slice(1),
  }),
}));
vi.mock("./guard-role-writes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard-role-writes.js")>()),
  harnessAllowed: (
    name: string,
    args: readonly string[],
    allowed: readonly string[],
  ) => name === "node" && allowed.includes(`${args[1] ?? ""} ${args[2] ?? ""}`),
  bareAssignment: (segment: readonly string[]) =>
    segment.length === 1 && /^[A-Za-z_]\w*=/.test(segment[0] ?? ""),
}));

const run = (...words: string[]): boolean => readMayRun(words, []);

describe("readMayRun: a lone NAME=value runs no command and is allowed", () => {
  it("allows a plain assignment and refuses one followed by a command", () => {
    expect(run("T=/tmp/x")).toBe(true);
    expect(run("T=x", "cat", "f")).toBe(false);
  });
});

describe("readMayRun: sed -n prints lines and never writes", () => {
  it("allows sed -n with a line range, a regex print or a printing substitution", () => {
    expect(run("sed", "-n", "1,40p", "AGENTS.md")).toBe(true);
    expect(run("sed", "-n", "$p", "AGENTS.md")).toBe(true);
    expect(run("sed", "-n", "/retro/p", "AGENTS.md")).toBe(true);
    expect(run("sed", "-n", "s/a/b/gp", "AGENTS.md")).toBe(true);
    expect(run("sed", "-n", "s#a#b#p", "AGENTS.md")).toBe(true);
  });

  it("refuses sed -i in every spelling, and any script that writes or runs a command", () => {
    expect(run("sed", "-i", "s/a/b/", "AGENTS.md")).toBe(false);
    expect(run("sed", "-ni", "1p", "AGENTS.md")).toBe(false);
    expect(run("sed", "-n", "1p", "-i", "AGENTS.md")).toBe(false);
    expect(run("sed", "-n", "w out.txt", "AGENTS.md")).toBe(false);
    expect(run("sed", "-n", "s/a/b/w out.txt", "AGENTS.md")).toBe(false);
    expect(run("sed", "-n", "1e touch a", "AGENTS.md")).toBe(false);
    expect(run("sed", "-n", "s/a/b/e", "AGENTS.md")).toBe(false);
    expect(run("sed", "-n", "-e", "1p", "AGENTS.md")).toBe(false);
    expect(run("sed", "-n", "/a\nw out.txt/p", "AGENTS.md")).toBe(false);
  });
});

describe("readMayRun: cd only changes directory", () => {
  it("allows a bare cd and cd to one path", () => {
    expect(run("cd")).toBe(true);
    expect(run("cd", "/Users/jun/.claude/projects/x")).toBe(true);
  });

  it("refuses cd with more than one argument or an option", () => {
    expect(run("cd", "a", "b")).toBe(false);
    expect(run("cd", "-P", "a")).toBe(false);
  });
});

describe("readMayRun: paste, cut, uniq, wc and tr are read utilities", () => {
  it("allows paste, cut, wc and tr on their input", () => {
    expect(run("paste", "-", "-")).toBe(true);
    expect(run("cut", "-c1-200", "AGENTS.md")).toBe(true);
    expect(run("wc", "-l", "AGENTS.md")).toBe(true);
    expect(run("tr", "a-z", "A-Z")).toBe(true);
  });

  it("allows uniq on standard input or one input file", () => {
    expect(run("uniq", "-c")).toBe(true);
    expect(run("uniq", "-c", "input.txt")).toBe(true);
  });

  it("refuses uniq with an output file, which is the second positional argument", () => {
    expect(run("uniq", "-c", "input.txt", "out.txt")).toBe(false);
  });
});

describe("readMayRun: awk without redirection, system(), getline or a pipe", () => {
  it("allows awk programs that only read their input", () => {
    expect(run("awk", "{print $1}", "AGENTS.md")).toBe(true);
    expect(run("awk", "-F:", "{print $1}", "/etc/passwd")).toBe(true);
    expect(run("awk", "-F", ":", "{print $1}", "AGENTS.md")).toBe(true);
    expect(run("awk", "-v", "n=2", "NR<n", "AGENTS.md")).toBe(true);
  });

  it("refuses a program that writes, runs a command or reads one", () => {
    expect(run("awk", '{print > "out"}', "AGENTS.md")).toBe(false);
    expect(run("awk", '{print >> "out"}', "AGENTS.md")).toBe(false);
    expect(run("awk", '{print | "sh"}', "AGENTS.md")).toBe(false);
    expect(run("awk", 'BEGIN{system("touch a")}')).toBe(false);
    expect(run("awk", 'BEGIN{while (("ls" | getline x) > 0) print x}')).toBe(
      false,
    );
  });

  it("refuses awk options that load a program file or edit in place", () => {
    expect(run("awk", "-f", "prog.awk", "AGENTS.md")).toBe(false);
    expect(run("awk", "-i", "inplace", "{print}", "AGENTS.md")).toBe(false);
    expect(run("awk", "-o", "out", "{print}", "AGENTS.md")).toBe(false);
  });
});

describe("readMayRun: the retro scan is a read", () => {
  it("allows node skills/bin/harness.mjs hook retro-scan, with its options", () => {
    expect(run("node", "skills/bin/harness.mjs", "hook", "retro-scan")).toBe(
      true,
    );
    expect(
      run(
        "node",
        "skills/bin/harness.mjs",
        "hook",
        "retro-scan",
        "--strict",
        "--since",
        "2026-11-13",
      ),
    ).toBe(true);
  });

  it("refuses retro-scan with a ledger, and any other hook or harness", () => {
    expect(
      run(
        "node",
        "skills/bin/harness.mjs",
        "hook",
        "retro-scan",
        "--ledger",
        "x.jsonl",
      ),
    ).toBe(false);
    expect(
      run("node", "skills/bin/harness.mjs", "hook", "retro-scan", "--ledger=x"),
    ).toBe(false);
    expect(run("node", "skills/bin/harness.mjs", "hook", "guard")).toBe(false);
    expect(run("node", "other/harness.mjs", "hook", "retro-scan")).toBe(false);
  });
});
