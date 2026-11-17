// The host shell check: a pure function of the hook's environment. It has no dependencies to mock.

import { homedir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { environments, FlagError, readOverlay } from "../flag/index.js";
import type { FileSystem } from "../runtime/index.js";
import { hostFacts, verifiedBash } from "./guard-host-shell.js";

vi.mock("node:os", () => ({ homedir: vi.fn(() => "/os/home") }));
vi.mock("../flag/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flag/index.js")>()),
  environments: vi.fn(),
  readOverlay: vi.fn(),
}));

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

const BASH = { HOME: "/home/test", CLAUDE_CODE_SHELL: "/bin/bash" };

/** Typed stand-ins for the file system and overlay, whose members the unit never reads itself. */
const fs = {} as FileSystem;
type Overlay = Awaited<ReturnType<typeof readOverlay>>;
const overlay = (features: Record<string, boolean>): Overlay => ({
  environment: "local",
  path: "infra/environments/local/environment.yaml",
  text: "",
  features,
});

beforeEach(() => {
  vi.mocked(environments).mockResolvedValue(["local"]);
  vi.mocked(readOverlay).mockResolvedValue(
    overlay({ "shell-aware-zsh-rules": true }),
  );
});

describe("hostFacts", () => {
  it("takes the home from the environment's HOME, as the shell reads it", async () => {
    expect(await hostFacts({ HOME: "/home/test" }, fs, "/repo")).toEqual({
      home: "/home/test",
      verifiedBash: false,
    });
  });

  it.each([
    ["unset", {}],
    ["empty", { HOME: "" }],
  ])(
    "falls back to the operating system's home when HOME is %s",
    async (_label, env) => {
      expect((await hostFacts(env, fs, "/repo")).home).toBe("/os/home");
      expect(homedir).toHaveBeenCalled();
    },
  );

  it("verifies bash when the shell names bash and the local overlay turns shell-aware-zsh-rules on", async () => {
    expect(await hostFacts(BASH, fs, "/repo")).toEqual({
      home: "/home/test",
      verifiedBash: true,
    });
    expect(readOverlay).toHaveBeenCalledWith(fs, "/repo", "local");
  });

  it("does not verify bash while the flag is off, so verdicts stay as today", async () => {
    vi.mocked(readOverlay).mockResolvedValue(
      overlay({ "shell-aware-zsh-rules": false }),
    );
    expect((await hostFacts(BASH, fs, "/repo")).verifiedBash).toBe(false);
  });

  it("does not verify bash when the overlay does not name the flag", async () => {
    vi.mocked(readOverlay).mockResolvedValue(overlay({}));
    expect((await hostFacts(BASH, fs, "/repo")).verifiedBash).toBe(false);
  });

  it("does not verify bash when there is no local overlay", async () => {
    vi.mocked(environments).mockResolvedValue([]);
    expect((await hostFacts(BASH, fs, "/repo")).verifiedBash).toBe(false);
    expect(readOverlay).not.toHaveBeenCalled();
  });

  it.each([
    ["a malformed overlay", new FlagError("bad overlay")],
    ["an unreadable one", new Error("EACCES")],
  ])("fails closed, not crashing the guard, on %s", async (_label, error) => {
    vi.mocked(readOverlay).mockRejectedValue(error);
    expect((await hostFacts(BASH, fs, "/repo")).verifiedBash).toBe(false);
  });

  it.each([
    ["zsh", { HOME: "/home/test", CLAUDE_CODE_SHELL: "/bin/zsh" }],
    ["no shell", { HOME: "/home/test" }],
  ])(
    "reads no overlay when the shell is %s, which needs no flag",
    async (_label, env) => {
      expect((await hostFacts(env, fs, "/repo")).verifiedBash).toBe(false);
      expect(environments).not.toHaveBeenCalled();
      expect(readOverlay).not.toHaveBeenCalled();
    },
  );
});
