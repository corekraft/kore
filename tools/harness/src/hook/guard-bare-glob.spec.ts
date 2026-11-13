import { describe, expect, it, vi } from "vitest";
import { bareGlob } from "./guard-bare-glob.js";
import type { GuardContext } from "./guard-verdict.js";

// The shell parser is a dependency of the rule, so the spec replaces it with a
// fake that splits on spaces and marks any word with * or ? as a glob.
vi.mock("./guard-shell.js", () => ({
  shellText: (command: string) => command,
  rawWords: (command: string) =>
    command.split(" ").map((text) => ({
      text,
      glob: /[*?]/.test(text),
      equals: false,
    })),
}));

const ctxWith = (
  globMatches: (pattern: string) => Promise<boolean>,
): GuardContext => ({
  root: "/repo",
  readFile: () => Promise.reject(new Error("ENOENT")),
  modeOf: () => "audit",
  denyRules: [],
  globMatches,
});

describe("bare-glob", () => {
  it("is silent when the glob matches a path, since zsh expands it as intended", async () => {
    const ctx = ctxWith(async (pattern) => pattern === "infra/*.yaml");
    expect(await bareGlob("ls infra/*.yaml", ctx)).toBeNull();
  });

  it("warns when the glob matches no path, naming the word and its quoted form", async () => {
    const ctx = ctxWith(async () => false);
    expect(await bareGlob("ls infra/*.yaml", ctx)).toEqual({
      action: "warn",
      rule: "bare-glob",
      message:
        '[guard:bare-glob] infra/*.yaml is an unquoted glob; zsh fails the whole command with "no matches found" when it matches no file. ' +
        "Instead, quote it ('infra/*.yaml') unless it must expand, and check that it matches.",
    });
  });

  it("warns about the unmatched glob when another glob in the command does match", async () => {
    const ctx = ctxWith(async (pattern) => pattern === "src/*.ts");
    const finding = await bareGlob("cat src/*.ts docs/*.zzz", ctx);
    expect(finding?.message).toContain(
      "[guard:bare-glob] docs/*.zzz is an unquoted glob",
    );
    expect(finding?.message).not.toContain("src/*.ts is an unquoted glob");
  });

  it("is silent when the command has no bare glob, and never looks at the filesystem", async () => {
    const matches = vi.fn(async () => false);
    expect(await bareGlob("git status", ctxWith(matches))).toBeNull();
    expect(matches).not.toHaveBeenCalled();
  });

  it("skips a word with parameter expansion, which is not a glob", async () => {
    const ctx = ctxWith(async () => false);
    expect(await bareGlob("echo ${name%.*}", ctx)).toBeNull();
  });
});
