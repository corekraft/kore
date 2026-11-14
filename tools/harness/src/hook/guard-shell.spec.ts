// Shell parsing for the guard: segments, command names, raw words and zsh qualifiers. `basename` is mocked.

import { basename } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  commandOf,
  execGlobQualifier,
  firstPositional,
  hasFlag,
  isKore,
  rawSegments,
  rawWords,
  scriptOf,
  shellText,
  splitSegments,
} from "./guard-shell.js";

vi.mock("node:path", () => ({ basename: vi.fn() }));

beforeEach(() => {
  vi.mocked(basename).mockImplementation(
    (path: string) => path.split("/").pop() ?? "",
  );
});

describe("splitSegments", () => {
  it("splits a command at ;, &&, || and | into segments of words", () => {
    expect(splitSegments("ls -la && echo hi; pwd | wc")).toEqual([
      ["ls", "-la"],
      ["echo", "hi"],
      ["pwd"],
      ["wc"],
    ]);
  });

  it("keeps quoted operators and spaces inside one word", () => {
    expect(splitSegments(`echo "a b" 'c;d'`)).toEqual([["echo", "a b", "c;d"]]);
  });

  it("honours a backslash escape outside quotes", () => {
    expect(splitSegments("echo a\\ b")).toEqual([["echo", "a b"]]);
  });

  it("starts a redirect glued to a word as its own word", () => {
    expect(splitSegments("echo x>file")).toEqual([["echo", "x", ">file"]]);
  });

  it("drops empty segments, so a lone separator yields nothing", () => {
    expect(splitSegments(" ; ")).toEqual([]);
  });

  it("separates chained commands at && and |, and keeps a quoted && inside one word", () => {
    expect(splitSegments("a && b; c | d")).toEqual([
      ["a"],
      ["b"],
      ["c"],
      ["d"],
    ]);
    expect(splitSegments('echo "a && b"')).toEqual([["echo", "a && b"]]);
  });
});

describe("commandOf", () => {
  it("skips env assignments and wrappers, then names the command by its basename", () => {
    expect(commandOf(["FOO=1", "sudo", "/usr/bin/git", "status"])).toEqual({
      name: "git",
      args: ["status"],
    });
  });

  it("names nothing when only wrappers and assignments are present", () => {
    expect(commandOf([])).toEqual({ name: "", args: [] });
    expect(commandOf(["env", "A=1"])).toEqual({ name: "", args: [] });
  });
});

describe("isKore, hasFlag and firstPositional", () => {
  it("recognises kore, npm run kore and node running the kore cli", () => {
    expect(isKore("kore", [])).toBe(true);
    expect(isKore("npm", ["run", "kore"])).toBe(true);
    expect(isKore("node", ["tools/kore/dist/cli/cli.js"])).toBe(true);
    expect(isKore("ls", ["-la"])).toBe(false);
  });

  it("finds a flag alone or with a value, and never a flag that only shares its prefix", () => {
    expect(hasFlag(["--force"], "--force")).toBe(true);
    expect(hasFlag(["--out=x"], "--out")).toBe(true);
    expect(hasFlag(["--outer"], "--out")).toBe(false);
  });

  it("returns the first argument that is not a flag, or none", () => {
    expect(firstPositional(["-x", "file", "b"])).toBe("file");
    expect(firstPositional(["-x"])).toBeUndefined();
  });
});

describe("shellText", () => {
  it("cuts a command at the line that opens its first heredoc", () => {
    expect(shellText("cat <<EOF\nbody rm -rf /\nEOF")).toBe("cat <<EOF");
  });

  it("returns a command without a heredoc unchanged", () => {
    expect(shellText("ls -la")).toBe("ls -la");
    expect(shellText("cat <<EOF")).toBe("cat <<EOF");
  });
});

describe("rawWords", () => {
  it("notes an unquoted glob and an unquoted leading =, but not a quoted glob", () => {
    expect(rawWords("echo *.ts 'a*' =x")).toEqual([
      { text: "echo", glob: false, equals: false },
      { text: "*.ts", glob: true, equals: false },
      { text: "a*", glob: false, equals: false },
      { text: "=x", glob: false, equals: true },
    ]);
  });

  it("keeps a special parameter such as $? as one word", () => {
    expect(rawWords("echo $?")).toEqual([
      { text: "echo", glob: false, equals: false },
      { text: "$?", glob: false, equals: false },
    ]);
  });
});

describe("rawSegments", () => {
  it("groups raw words by the segment they belong to", () => {
    const texts = rawSegments("a | b; c").map((segment) =>
      segment.map((word) => word.text),
    );
    expect(texts).toEqual([["a"], ["b"], ["c"]]);
  });
});

describe("shell escapes and edge cases", () => {
  it("keeps an escaped quote inside double quotes, and an escaped glob outside them as text", () => {
    expect(splitSegments('echo "a\\"b"')).toEqual([["echo", 'a"b']]);
    expect(rawWords('"a\\"b"')).toEqual([
      { text: 'a"b', glob: false, equals: false },
    ]);
    expect(rawWords("a\\*")).toEqual([
      { text: "a*", glob: false, equals: false },
    ]);
  });

  it("reads a trailing backslash as nothing, and a lone = followed by a space as plain text", () => {
    expect(rawWords("a\\")).toEqual([
      { text: "a", glob: false, equals: false },
    ]);
    expect(rawWords("a = b")).toEqual([
      { text: "a", glob: false, equals: false },
      { text: "=", glob: false, equals: false },
      { text: "b", glob: false, equals: false },
    ]);
  });

  it("finds no qualifier at the very start of a command", () => {
    expect(execGlobQualifier("(e:x)")).toBeUndefined();
  });
});

describe("execGlobQualifier", () => {
  it("finds a glob qualifier that evaluates a string, e:'...':", () => {
    expect(execGlobQualifier("ls *(e:'rm -rf /':)")).toBe("*(e:'rm -rf /':)");
  });

  it("finds a glob qualifier that calls a function, +name", () => {
    expect(execGlobQualifier("ls *(+func)")).toBe("*(+func)");
  });

  it("ignores a substitution, and a qualifier inside quotes", () => {
    expect(execGlobQualifier("echo $(whoami)")).toBeUndefined();
    expect(execGlobQualifier("echo 'x(e:1)'")).toBeUndefined();
  });
});

describe("scriptOf", () => {
  it("returns the script a shell runs with -c, including a combined flag such as -lc", () => {
    expect(scriptOf(["bash", "-lc", "rm -rf x"])).toBe("rm -rf x");
    expect(scriptOf(["sh", "-c"])).toBeUndefined();
  });

  it("returns the joined line that eval runs, and nothing for another command", () => {
    expect(scriptOf(["eval", "a", "b"])).toBe("a b");
    expect(scriptOf(["git", "status"])).toBeUndefined();
  });
});
