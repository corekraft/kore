import { basename } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { block } from "./guard-verdict.js";
import { commandLookup } from "./guard-role-reads.js";
import { commandOf } from "./guard-shell.js";
import {
  bareAssignment,
  changesShell,
  harnessAllowed,
  harnessStatus,
  notifiesFinish,
  redirectTargets,
  removal,
  sendsToPane,
  setsEnvironment,
  withoutRedirects,
  writes,
  wrapsCommands,
  notRead,
  readOnly,
  useNotify,
} from "./guard-role-writes.js";

vi.mock("node:path");
vi.mock("./guard-shell.js");
vi.mock("./guard-role-reads.js");
vi.mock("./guard-verdict.js");

/** Fake shell: the first word names the command, the rest are its arguments. */
const words = (tokens: readonly string[]) => ({
  name: tokens[0] ?? "",
  args: tokens.slice(1),
});

beforeEach(() => {
  vi.mocked(commandLookup).mockReturnValue(false);
  vi.mocked(commandOf).mockImplementation(words);
  vi.mocked(basename).mockImplementation((path) => path.split("/").pop() ?? "");
  vi.mocked(block).mockImplementation((rule, message) => ({
    action: "block",
    rule,
    message: `[guard:${rule}] ${message}`,
  }));
});

describe("writes: a file change is a write, a read is not", () => {
  it("flags a redirect to a file, glued or spaced, whatever the command", () => {
    expect(writes(["cut", "-c1-2", "f", ">", "out"])).toBe(true);
    expect(writes(["cut", "-c1-2", "f", ">>out"])).toBe(true);
    expect(writes(["awk", "{print}", "f", ">", "out.txt"])).toBe(true);
  });

  it("flags sed -i in every spelling", () => {
    expect(writes(["sed", "-i", "s/a/b/", "f"])).toBe(true);
    expect(writes(["sed", "-ni", "1p", "f"])).toBe(true);
  });

  it("does not flag a redirect to /dev/null or the reads that were just allowed", () => {
    expect(writes(["sed", "-n", "1p", "f", "2>/dev/null"])).toBe(false);
    expect(writes(["sed", "-n", "1,40p", "f"])).toBe(false);
    expect(writes(["cut", "-c1-200", "f"])).toBe(false);
    expect(writes(["paste", "-", "-"])).toBe(false);
    expect(writes(["tr", "a-z", "A-Z"])).toBe(false);
    expect(writes(["wc", "-l", "f"])).toBe(false);
  });

  it.each(["tee", "cp", "mv", "rm", "mkdir", "touch", "dd"])(
    "flags the writer command %s, whatever its arguments",
    (name) => {
      expect(writes([name, "a", "b"])).toBe(true);
    },
  );

  it.each([
    ["git commit", ["git", "commit", "-m", "x"]],
    ["git checkout", ["git", "checkout", "main"]],
    ["gh pr merge", ["gh", "pr", "merge", "12"]],
    ["gh pr close", ["gh", "pr", "close", "12"]],
  ])("flags %s, which changes history or a pull request", (_name, segment) => {
    expect(writes(segment)).toBe(true);
  });

  it("does not flag a read-only git verb or a gh pr read", () => {
    expect(writes(["git", "log", "-n", "3"])).toBe(false);
    expect(writes(["gh", "pr", "view", "12"])).toBe(false);
  });
});

describe("redirectTargets and withoutRedirects: the files a segment writes", () => {
  it("names the file a redirect writes, spaced or glued, and skips /dev/null and a stream", () => {
    expect(redirectTargets(["echo", "a", ">", "out.txt"])).toEqual(["out.txt"]);
    expect(redirectTargets(["echo", "a", "2>>err.log"])).toEqual(["err.log"]);
    expect(redirectTargets(["echo", "a", ">", "/dev/null"])).toEqual([]);
    expect(redirectTargets(["echo", "a", "2>&1"])).toEqual([]);
  });

  it("leaves the command's own words when the redirects are taken out", () => {
    expect(withoutRedirects(["echo", "a", ">", "out.txt", "2>>err"])).toEqual([
      "echo",
      "a",
    ]);
  });
});

describe("bareAssignment: a plain NAME=value and nothing else", () => {
  it("is not a bare assignment for HC_TERMINAL_ID, which steers the terminal hc commands see", () => {
    expect(bareAssignment(["HC_TERMINAL_ID=t1"])).toBe(false);
  });

  it("accepts a lone variable assignment", () => {
    expect(bareAssignment(["T=/a/b"])).toBe(true);
  });

  it("accepts an assignment whose redirect is a file write, which writes() still flags", () => {
    expect(bareAssignment(["T=x", ">", "a"])).toBe(true);
    expect(writes(["T=x", ">", "a"])).toBe(true);
  });

  it("refuses several assignments, an assignment before a command, and export", () => {
    expect(bareAssignment(["A=1", "B=2"])).toBe(false);
    expect(bareAssignment(["T=x", "cat", "f"])).toBe(false);
    expect(bareAssignment(["export", "X=1"])).toBe(false);
  });

  it("refuses names a program reads at run time, so a bare assignment cannot steer git or the shell", () => {
    expect(bareAssignment(["PAGER=less"])).toBe(false);
    expect(bareAssignment(["GIT_EXTERNAL_DIFF=x"])).toBe(false);
    expect(bareAssignment(["PATH=/tmp"])).toBe(false);
    expect(bareAssignment(["HOME=/tmp"])).toBe(false);
    expect(bareAssignment(["KORE_ROOT=/tmp"])).toBe(false);
  });
});

describe("setsEnvironment: a bare assignment passes, a prefix or export is refused", () => {
  it("passes a lone assignment, which is no environment change", () => {
    expect(setsEnvironment(["T=x"])).toBe(false);
  });

  it("refuses an assignment before a command, a steering name, export and the wrappers", () => {
    expect(setsEnvironment(["T=x", "cat", "f"])).toBe(true);
    expect(setsEnvironment(["PAGER=x"])).toBe(true);
    expect(setsEnvironment(["export", "X=1"])).toBe(true);
    expect(setsEnvironment(["env", "X=1", "cat"])).toBe(true);
    expect(setsEnvironment(["sudo", "x"])).toBe(true);
  });

  it("passes a plain command", () => {
    expect(setsEnvironment(["cat", "f"])).toBe(false);
  });

  it("passes command -v only when its shape check passes it, and refuses command as a wrapper", () => {
    vi.mocked(commandLookup).mockReturnValue(true);
    expect(setsEnvironment(["command", "-v", "git"])).toBe(false);

    vi.mocked(commandLookup).mockReturnValue(false);
    expect(setsEnvironment(["command", "-v", "git"])).toBe(true);
    expect(setsEnvironment(["command", "git", "push"])).toBe(true);
  });

  it("refuses a builtin that changes shell state or sources a file", () => {
    expect(changesShell(["source", "env.sh"])).toBe(true);
    expect(changesShell(["alias", "x=y"])).toBe(true);
    expect(changesShell(["cat", "f"])).toBe(false);
  });
});

describe("wrapsCommands: a segment that launches other command lines", () => {
  it.each([
    ["a subshell", ["(cat", "f)"]],
    ["a group", ["{", "cat", "f", "}"]],
    ["an interpreter on a string", ["bash", "-c", "cat f"]],
    ["xargs", ["xargs", "cat"]],
    ["a control keyword", ["while", "true"]],
  ])("is true for %s", (_name, segment) => {
    expect(wrapsCommands(segment)).toBe(true);
  });

  it("is false for a plain command", () => {
    expect(wrapsCommands(["cat", "f"])).toBe(false);
  });
});

describe("harnessAllowed and harnessStatus: which harness commands a role may run", () => {
  it("allows a harness command on the role's list, and refuses one that is not", () => {
    const allowed = ["ledger list"];
    expect(
      harnessAllowed(
        "node",
        ["skills/bin/harness.mjs", "ledger", "list"],
        allowed,
      ),
    ).toBe(true);
    expect(
      harnessAllowed(
        "node",
        ["skills/bin/harness.mjs", "ledger", "write"],
        allowed,
      ),
    ).toBe(false);
  });

  it("refuses a --ledger option, which would name a file to append to", () => {
    expect(
      harnessAllowed(
        "node",
        ["skills/bin/harness.mjs", "ledger", "list", "--ledger=x"],
        ["ledger list"],
      ),
    ).toBe(false);
  });

  it("refuses a command that is not the harness bundle", () => {
    expect(
      harnessAllowed("node", ["other.mjs", "ledger", "list"], ["ledger list"]),
    ).toBe(false);
  });

  it("allows harness status bare or with --json, and nothing else", () => {
    expect(harnessStatus("node", ["skills/bin/harness.mjs", "status"])).toBe(
      true,
    );
    expect(
      harnessStatus("node", ["skills/bin/harness.mjs", "status", "--json"]),
    ).toBe(true);
    expect(
      harnessStatus("node", ["skills/bin/harness.mjs", "status", "--all"]),
    ).toBe(false);
  });
});

describe("notifiesFinish and sendsToPane: the only pane traffic a role sends", () => {
  it("allows the finish notice in its one shape, done or blocked", () => {
    expect(
      notifiesFinish([
        "node",
        "skills/bin/harness.mjs",
        "session",
        "notify",
        "w3:p1",
        "--outcome",
        "done",
      ]),
    ).toBe(true);
  });

  it("refuses a finish notice with another outcome or extra words", () => {
    expect(
      notifiesFinish([
        "node",
        "skills/bin/harness.mjs",
        "session",
        "notify",
        "w3:p1",
        "--outcome",
        "maybe",
      ]),
    ).toBe(false);
    expect(
      notifiesFinish([
        "node",
        "skills/bin/harness.mjs",
        "session",
        "notify",
        "w3:p1",
        "--outcome",
        "done",
        "extra",
      ]),
    ).toBe(false);
  });

  it("flags raw input typed into a pane, which only send-text and send-keys do", () => {
    expect(sendsToPane(["herdr", "pane", "send-text", "w3:p1", "x"])).toBe(
      true,
    );
    expect(sendsToPane(["herdr", "pane", "send-keys", "w3:p1"])).toBe(true);
    expect(sendsToPane(["herdr", "pane", "list"])).toBe(false);
  });
});

describe("removal: the sources a remove or move names", () => {
  it("names the sources of rm, without its -f flag", () => {
    expect(removal(["rm", "-f", "a", "b"])).toEqual({ sources: ["a", "b"] });
  });

  it("names the sources and destination of git mv", () => {
    expect(removal(["git", "mv", "a", "b", "dir/"])).toEqual({
      sources: ["a", "b"],
      destination: "dir/",
    });
  });

  it("names the sources of git rm", () => {
    expect(removal(["git", "rm", "-r", "docs"])).toEqual({
      sources: ["-r", "docs"],
    });
  });

  it("is undefined for a command that does not remove or move", () => {
    expect(removal(["git", "status"])).toBeUndefined();
  });
});

describe("readOnly and useNotify: the findings a refused role receives", () => {
  it("blocks a write with the read-only rule, and blocks raw pane input with the finish notice", () => {
    expect(readOnly("this command")).toHaveProperty(
      "message",
      expect.stringContaining("this command changes files"),
    );
    expect(useNotify("this")).toHaveProperty(
      "message",
      expect.stringContaining("session notify <pane> --outcome done|blocked"),
    );
  });
});

describe("notRead: a refused read is not told it changes files", () => {
  it("names the reads that work, and never says the refused command changes files", () => {
    expect(notRead("`git merge-base a b`")).toEqual({
      action: "block",
      rule: "role-read-only",
      message:
        "[guard:role-read-only] `git merge-base a b` is refused: a read-only role runs only the reads it allows. Instead, run one of these reads, such as `cat`, `head`, `tail`, `ls`, `grep`, `rg`, `wc`, `sort`, `diff`, `tree`, `jq`, `stat`, `file`, `git log`, `git status`, `git show`, `git diff`, `git blame`, `git ls-files`, `git grep`, `git rev-parse`, `gh pr view`, `gh pr list`, `gh pr checks`, `gh pr diff`, `gh issue view`, `gh issue list`, `gh label list`, `node skills/bin/harness.mjs plan active`, `node skills/bin/harness.mjs idea list`, `node skills/bin/harness.mjs idea show`, `node skills/bin/harness.mjs flow report`, `node skills/bin/harness.mjs ledger list`. If none of them does what you need, report what needs changing: the reader returns it in its summary and the judge sends the change back.",
    });
  });

  it("keeps a write saying it changes files, since a write does", () => {
    expect(readOnly("`tee out`")).toHaveProperty(
      "message",
      "[guard:role-read-only] `tee out` changes files, and the reader and judge never write. Instead, report what needs changing: the reader returns it in its summary and the judge sends the change back.",
    );
  });
});
