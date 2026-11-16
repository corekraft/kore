// The host shell check: a pure function of the hook's environment. It has no dependencies to mock.

import { homedir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { hostFacts, verifiedBash } from "./guard-host-shell.js";

vi.mock("node:os", () => ({ homedir: vi.fn(() => "/os/home") }));

describe("verifiedBash", () => {
  it.each([
    ["a bare name", { CLAUDE_CODE_SHELL: "bash" }],
    ["an absolute path", { CLAUDE_CODE_SHELL: "/opt/homebrew/bin/bash" }],
    ["the system bash", { CLAUDE_CODE_SHELL: "/bin/bash" }],
    ["SHELL when CLAUDE_CODE_SHELL is unset", { SHELL: "/bin/bash" }],
    [
      "SHELL when CLAUDE_CODE_SHELL is empty",
      { CLAUDE_CODE_SHELL: "", SHELL: "/bin/bash" },
    ],
    [
      "CLAUDE_CODE_SHELL over a zsh SHELL",
      { CLAUDE_CODE_SHELL: "/bin/bash", SHELL: "/bin/zsh" },
    ],
  ])("is true for %s", (_label, env) => {
    expect(verifiedBash(env)).toBe(true);
  });

  it.each([
    ["no variable", {}],
    ["an empty CLAUDE_CODE_SHELL and no SHELL", { CLAUDE_CODE_SHELL: "" }],
    ["zsh", { CLAUDE_CODE_SHELL: "/bin/zsh" }],
    ["an unknown shell", { CLAUDE_CODE_SHELL: "/usr/bin/fish" }],
    ["a name that only contains bash", { SHELL: "/bin/notbash" }],
    ["a name that only starts with bash", { SHELL: "/bin/bashful" }],
    ["a command line, not a shell", { SHELL: "bash -c id" }],
    ["a directory called bash", { SHELL: "/opt/bash/zsh" }],
    [
      "CLAUDE_CODE_SHELL of zsh over a SHELL of bash",
      { CLAUDE_CODE_SHELL: "/bin/zsh", SHELL: "/bin/bash" },
    ],
  ])("is false for %s", (_label, env) => {
    expect(verifiedBash(env)).toBe(false);
  });
});

describe("hostFacts", () => {
  it("takes the home from the environment's HOME, as the shell reads it", () => {
    expect(hostFacts({ HOME: "/home/test" })).toEqual({
      home: "/home/test",
      verifiedBash: false,
    });
  });

  it.each([
    ["unset", {}],
    ["empty", { HOME: "" }],
  ])(
    "falls back to the operating system's home when HOME is %s",
    (_label, env) => {
      expect(hostFacts(env).home).toBe("/os/home");
      expect(homedir).toHaveBeenCalled();
    },
  );

  it("carries the verified shell beside the home", () => {
    expect(
      hostFacts({ HOME: "/home/test", CLAUDE_CODE_SHELL: "/bin/bash" }),
    ).toEqual({ home: "/home/test", verifiedBash: true });
  });
});
