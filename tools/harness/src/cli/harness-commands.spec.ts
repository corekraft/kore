import { describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import type { Command } from "../runtime/index.js";
import { contextWith } from "./command-support.js";
import { harnessCommands } from "./harness-commands.js";
import { harnessWait } from "./wait-command.js";

vi.mock("./wait-command.js", () => ({
  harnessWait: { summary: "wait", run: vi.fn() },
}));

/** The version command, as the harness domain holds it. */
function versionCommand(): Command {
  const version = harnessCommands["version"];
  if (version === undefined) {
    throw new Error("the harness domain has no version command");
  }
  return version;
}

describe("the harness domain's commands", () => {
  it("holds the version and the background wait, and nothing else", () => {
    expect(Object.keys(harnessCommands)).toEqual(["version", "wait"]);
    expect(harnessCommands["wait"]?.run).toBe(harnessWait.run);
  });

  it("carries a help record for each command, and the wait names each exit code it returns", () => {
    expect(harnessCommands["version"]?.help?.exits).toEqual([
      { code: 0, meaning: expect.any(String) },
    ]);
    expect(
      harnessCommands["wait"]?.help?.exits.map((exit) => exit.code),
    ).toEqual([0, 1, 2, 3]);
  });

  it("prints the package version as text, and exits 0", async () => {
    const stdout = vi.fn<(text: string) => void>();

    expect(await versionCommand().run(contextWith({ stdout }, {}, false))).toBe(
      0,
    );
    expect(stdout).toHaveBeenCalledExactlyOnceWith(`harness ${pkg.version}\n`);
  });

  it("prints the package version as one JSON object with --json", async () => {
    const stdout = vi.fn<(text: string) => void>();

    expect(await versionCommand().run(contextWith({ stdout }, {}, true))).toBe(
      0,
    );
    expect(stdout).toHaveBeenCalledExactlyOnceWith(
      `${JSON.stringify({ version: pkg.version })}\n`,
    );
  });
});
