import { beforeEach, describe, expect, it, vi } from "vitest";
import { ghMayRun, readMayRun } from "./guard-role-allow.js";
import {
  bareAssignment,
  harnessAllowed,
  WORKING_READS,
} from "./guard-role-writes.js";
import {
  commandLookup,
  gitReadMayRun,
  whichMayRun,
} from "./guard-role-reads.js";
import { commandOf } from "./guard-shell.js";

// commandOf, harnessAllowed and bareAssignment are collaborators outside the unit: typed
// mocks stand in for them. Constants (HARNESS) stay real, as ADR 0098 allows.
vi.mock("./guard-shell.js");
vi.mock("./guard-role-reads.js");
vi.mock("./guard-role-writes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard-role-writes.js")>()),
  harnessAllowed: vi.fn(),
  bareAssignment: vi.fn(),
}));

const run = (...words: string[]): boolean => readMayRun(words, []);
const mayRun = (line: string[]): boolean => run(...line);

beforeEach(() => {
  vi.mocked(commandOf).mockImplementation((tokens) => ({
    name: tokens[0] ?? "",
    args: tokens.slice(1),
  }));
  vi.mocked(harnessAllowed).mockImplementation(
    (name, args, allowed) =>
      name === "node" && allowed.includes(`${args[1] ?? ""} ${args[2] ?? ""}`),
  );
  vi.mocked(commandLookup).mockReturnValue(false);
  vi.mocked(gitReadMayRun).mockReturnValue(false);
  vi.mocked(whichMayRun).mockReturnValue(false);
  vi.mocked(bareAssignment).mockImplementation(
    (segment) =>
      segment.length === 1 && /^[A-Za-z_]\w*=/.test(segment[0] ?? ""),
  );
});

describe("ghMayRun: the read-only gh verbs", () => {
  it.each([
    ["issue", "view"],
    ["issue", "list"],
    ["issue", "status"],
    ["label", "list"],
    ["pr", "view"],
    ["pr", "list"],
    ["pr", "status"],
    ["pr", "checks"],
  ])("allows gh %s %s", (group, verb) => {
    expect(ghMayRun([group, verb], false)).toBe(true);
  });

  it("allows gh pr diff only when the role may see code", () => {
    expect(ghMayRun(["pr", "diff"], false)).toBe(false);
    expect(ghMayRun(["pr", "diff"], true)).toBe(true);
  });

  it.each([
    ["pr", "merge"],
    ["pr", "create"],
    ["issue", "create"],
    ["label", "create"],
    ["repo", "view"],
  ])(
    "refuses gh %s %s, which writes or reads outside the list",
    (group, verb) => {
      expect(ghMayRun([group, verb], true)).toBe(false);
    },
  );
});

describe("readMayRun: find, git and gh", () => {
  it("allows a find that only lists", () => {
    expect(mayRun(["find", ".", "-name", "*.md"])).toBe(true);
  });

  it.each(["-delete", "-exec", "-execdir", "-ok", "-fprint", "-fls"])(
    "refuses a find with %s, which deletes, runs or writes",
    (action) => {
      expect(mayRun(["find", ".", action])).toBe(false);
    },
  );

  it.each([
    ["log", ["log", "-n", "3"]],
    ["diff", ["diff", "HEAD"]],
    ["ls-files", ["ls-files"]],
  ])("allows read-only git %s", (_verb, args) => {
    expect(mayRun(["git", ...args])).toBe(true);
  });

  it("refuses a git verb that writes, such as push or commit", () => {
    expect(mayRun(["git", "push", "origin", "main"])).toBe(false);
    expect(mayRun(["git", "commit", "-m", "x"])).toBe(false);
  });

  it.each([
    ["--output", ["log", "--output=x"]],
    ["--exec-path", ["log", "--exec-path=/bin"]],
    ["--git-dir", ["log", "--git-dir=/elsewhere"]],
    ["-O", ["log", "-Oorder"]],
  ])(
    "refuses a read-only git verb given %s, which writes or runs",
    (_name, args) => {
      expect(mayRun(["git", ...args])).toBe(false);
    },
  );

  it("allows gh pr view and refuses gh pr merge", () => {
    expect(mayRun(["gh", "pr", "view", "12"])).toBe(true);
    expect(mayRun(["gh", "pr", "merge", "12"])).toBe(false);
  });
});

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

  it("allows several semicolon-joined print ranges and escaped slashes", () => {
    expect(run("sed", "-n", "1,5p;10,20p", "AGENTS.md")).toBe(true);
    expect(run("sed", "-n", "1,5p;$p;/a/p", "AGENTS.md")).toBe(true);
    expect(run("sed", "-n", "/a\\/b/p", "AGENTS.md")).toBe(true);
  });

  it("refuses a joined script when any part writes or runs a command", () => {
    expect(run("sed", "-n", "1,5p;w out.txt", "AGENTS.md")).toBe(false);
    expect(run("sed", "-n", "1,5p;10W out.txt", "AGENTS.md")).toBe(false);
    expect(run("sed", "-n", "1p;2e touch a", "AGENTS.md")).toBe(false);
    expect(run("sed", "-n", "1p;r /etc/passwd", "AGENTS.md")).toBe(false);
    expect(run("sed", "-n", "1p;", "AGENTS.md")).toBe(false);
    expect(run("sed", "-n", "1p;2p", "-i", "AGENTS.md")).toBe(false);
    expect(run("sed", "-ni", "1p;2p", "AGENTS.md")).toBe(false);
    expect(run("sed", "-n", "-e", "1p;2p", "AGENTS.md")).toBe(false);
    expect(run("sed", "-n", "/a\\/w out/p;1p", "AGENTS.md")).toBe(true);
    expect(run("sed", "-n", "/a/w out;1p", "AGENTS.md")).toBe(false);
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
    expect(run("uniq", "-", "out.txt")).toBe(false);
    expect(run("uniq", "--", "a", "b")).toBe(false);
    expect(run("uniq", "-c", "-")).toBe(true);
    expect(run("uniq", "--", "-x")).toBe(true);
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

describe("readMayRun: read utilities and their write options", () => {
  it("allows a read utility with no write option, and sort and uniq on their input", () => {
    expect(run("cat", "a.md")).toBe(true);
    expect(run("sort", "a.txt")).toBe(true);
    expect(run("uniq", "in.txt")).toBe(true);
    expect(run("uniq", "in.txt", "out.txt")).toBe(false);
  });

  it.each([
    ["sort -o", ["sort", "-o", "out", "in"]],
    ["sort --output", ["sort", "--output=out", "in"]],
    ["tree -R", ["tree", "-R", "."]],
    ["date -s", ["date", "-s", "now"]],
    ["rg --pre", ["rg", "--pre", "cmd", "x"]],
    ["file -C", ["file", "-C", "x"]],
  ])("refuses %s, which writes a file or runs a program", (_name, line) => {
    expect(mayRun(line)).toBe(false);
  });

  it("refuses a command the allowlist does not name", () => {
    expect(mayRun(["rm", "-rf", "x"])).toBe(false);
  });
});

describe("the reads the refusal names are reads the guard allows", () => {
  // The harness reads a reader may run, as the reader's allowlist passes them.
  const HARNESS_READS = [
    "plan active",
    "idea list",
    "idea show",
    "flow report",
    "ledger list",
  ];

  it.each(WORKING_READS)("allows %s", (line) => {
    expect(readMayRun(line.split(" "), HARNESS_READS)).toBe(true);
  });

  it("still refuses git fetch, which writes refs and objects, so the message does not promise it", () => {
    expect(mayRun(["git", "fetch", "origin"])).toBe(false);
  });
});
