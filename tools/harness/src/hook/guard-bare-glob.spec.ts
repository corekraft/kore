import { beforeEach, describe, expect, it, vi } from "vitest";
import { bareGlob } from "./guard-bare-glob.js";
import { rawWords, shellText } from "./guard-shell.js";
import { warn, type GuardContext } from "./guard-verdict.js";

vi.mock("./guard-shell.js");
vi.mock("./guard-verdict.js");

const WARNING = {
  action: "warn" as const,
  rule: "bare-glob",
  message: "warned",
};

const message = (word: string) =>
  `${word} is an unquoted glob; zsh fails the whole command with "no matches found" when it matches no file. ` +
  `Instead, quote it ('${word}') unless it must expand, and check that it matches.`;

// Scans a command with the parser mocked: words split on spaces, a * or ? marks a glob.
function scan(
  command: string,
  globMatches: GuardContext["globMatches"] = () => Promise.resolve(false),
) {
  vi.mocked(shellText).mockReturnValue(command);
  vi.mocked(rawWords).mockReturnValue(
    command.split(" ").map((text) => ({
      text,
      glob: /[*?]/.test(text),
      equals: false,
    })),
  );
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
  vi.clearAllMocks();
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
