import { beforeEach, describe, expect, it, vi } from "vitest";
import { bareGlob } from "./guard-bare-glob.js";
import { rawSegments, shellText, type RawWord } from "./guard-shell.js";
import { warn, type GuardContext } from "./guard-verdict.js";

vi.mock("./guard-shell.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard-shell.js")>()),
  shellText: vi.fn(),
  rawSegments: vi.fn(),
}));
vi.mock("./guard-verdict.js");

const WARNING = {
  action: "warn" as const,
  rule: "bare-glob",
  message: "warned",
};

const message = (word: string) =>
  `${word} is an unquoted glob; zsh fails the whole command with "no matches found" when it matches no file. ` +
  `Instead, quote it ('${word}') unless it must expand, and check that it matches.`;

// Splits a command into segments at ; && || | and newlines, then words at spaces;
// parentheses are word breaks. A * or ? marks a glob, as the scanner does.
function segmentsOf(command: string): RawWord[][] {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map((part) =>
      part
        .replace(/[()]/g, " ")
        .split(" ")
        .filter((text) => text !== "")
        .map((text) => ({ text, glob: /[*?]/.test(text), equals: false })),
    )
    .filter((segment) => segment.length > 0);
}

// Scans a command with the scanner mocked to the segments above.
function scan(
  command: string,
  globMatches: GuardContext["globMatches"] = () => Promise.resolve(false),
) {
  vi.mocked(shellText).mockReturnValue(command);
  vi.mocked(rawSegments).mockReturnValue(segmentsOf(command));
  const ctx: GuardContext = {
    root: "/repo",
    readFile: () => Promise.reject(new Error("ENOENT")),
    modeOf: () => "audit",
    denyRules: [],
    globMatches,
  };
  return bareGlob(command, ctx);
}

beforeEach(() => {
  vi.mocked(warn).mockReturnValue(WARNING);
});

describe("bare-glob", () => {
  it("is silent when the glob matches a path, since zsh expands it as intended", async () => {
    const result = await scan("ls infra/*.yaml", async () => true);
    expect(result).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when the glob matches no path, naming the word and its quoted form", async () => {
    expect(await scan("ls infra/*.yaml")).toBe(WARNING);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "bare-glob",
      message("infra/*.yaml"),
    );
  });

  it("warns only about the glob that matches nothing when another glob in the command matches", async () => {
    const result = await scan(
      "cat src/*.ts docs/*.zzz",
      async (pattern) => pattern === "src/*.ts",
    );
    expect(result).toBe(WARNING);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "bare-glob",
      message("docs/*.zzz"),
    );
  });

  it("is silent for a command with no glob, and never asks the filesystem", async () => {
    const matches = vi.fn(async () => false);
    expect(await scan("git status", matches)).toBeNull();
    expect(matches).not.toHaveBeenCalled();
  });

  it("skips a word with parameter expansion, which is not a glob", async () => {
    const matches = vi.fn(async () => false);
    expect(await scan("echo ${name%.*}", matches)).toBeNull();
    expect(matches).not.toHaveBeenCalled();
  });

  it("warns without walking for a glob that is absolute, starts with ~ or .., or has **", async () => {
    for (const word of [
      "/etc/*.conf",
      "~/*.yaml",
      "../*.yaml",
      "src/**/*.zzz",
    ]) {
      const matches = vi.fn(async () => true);
      expect(await scan(`ls ${word}`, matches), word).toBe(WARNING);
      expect(matches, word).not.toHaveBeenCalled();
      expect(warn, word).toHaveBeenLastCalledWith("bare-glob", message(word));
    }
  });

  it("warns, and does not reject, when the filesystem match fails", async () => {
    const result = await scan("ls infra/*.yaml", () =>
      Promise.reject(new Error("EACCES: permission denied")),
    );
    expect(result).toBe(WARNING);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "bare-glob",
      message("infra/*.yaml"),
    );
  });
});

describe("bare-glob, pattern arguments", () => {
  it.each([
    "grep Closed* src/index.ts",
    "egrep Closed* src/index.ts",
    "fgrep Closed* src/index.ts",
    "rg Closed* src/index.ts",
    "git grep Closed* src/index.ts",
    "sed s/Closed*/done/ src/index.ts",
    "awk /Closed*/ src/index.ts",
    "grep -n -e Closed* src/index.ts",
  ])(
    "is silent for an unquoted glob character in the pattern argument of a search tool: %s",
    async (command) => {
      expect(await scan(command)).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it("still warns for a path argument of a search tool that matches nothing", async () => {
    expect(await scan("grep Closed* docs/*.zzz")).toBe(WARNING);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "bare-glob",
      message("docs/*.zzz"),
    );
  });

  it("keeps today's behaviour for a tool that is not on the pattern list", async () => {
    expect(await scan("mytool Closed*")).toBe(WARNING);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "bare-glob",
      message("Closed*"),
    );
  });

  it("is silent for a glob character in a [[ ]] comparison pattern", async () => {
    expect(await scan("[[ $x == Closed* ]]")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("still warns for a path inside [[ ]] that matches nothing", async () => {
    expect(await scan("[[ -f docs/*.zzz ]]")).toBe(WARNING);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "bare-glob",
      message("docs/*.zzz"),
    );
  });

  it("is silent for the case patterns of a case statement", async () => {
    expect(await scan("case $x in\nClosed*) echo ok\n;;\nesac")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("still warns for a path in the body of a case arm", async () => {
    expect(await scan("case $x in\na) cat docs/*.zzz\n;;\nesac")).toBe(WARNING);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "bare-glob",
      message("docs/*.zzz"),
    );
  });

  it("is silent for a lone * operand in a test, which is not a glob", async () => {
    expect(await scan("[ * $n * ]")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
