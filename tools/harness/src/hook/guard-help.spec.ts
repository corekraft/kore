// The help exemption's flag read (#973): the help word a command carries, and the flag read for a
// Bash help request. The local flag read is mocked; the spec tests only the decision made from it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { helpExemptOn, HELP_EXEMPT_FLAG, namesHelpFlag } from "./guard-help.js";
import { localFlagOn } from "./guard-local-flag.js";
import type { FileSystem } from "../runtime/index.js";

vi.mock("./guard-local-flag.js");

const fs = {} as FileSystem;

beforeEach(() => {
  vi.mocked(localFlagOn).mockResolvedValue(true);
});

describe("namesHelpFlag: a command text that carries --help or -h as a word", () => {
  it.each([
    [
      "--help at the end",
      "node skills/bin/harness.mjs flag activate --help",
      true,
    ],
    [
      "-h before another word",
      "node skills/bin/harness.mjs flag activate -h --json",
      true,
    ],
    ["--helpful", "node skills/bin/harness.mjs flag activate --helpful", false],
    ["-hx", "node skills/bin/harness.mjs flag activate -hx", false],
    ["help glued to a word", "echo ahelp", false],
    ["no command text", undefined, false],
  ])("is %s, so %s", (_label, command, expected) => {
    expect(namesHelpFlag(command)).toBe(expected);
  });
});

describe("helpExemptOn: the flag is read only for a Bash help request", () => {
  it("reads gated-help-exempt from the local overlay for a Bash help request, and returns its value", async () => {
    expect(
      await helpExemptOn(fs, "/repo", {
        tool_name: "Bash",
        tool_input: {
          command: "node skills/bin/harness.mjs flag activate --help",
        },
      }),
    ).toBe(true);
    expect(localFlagOn).toHaveBeenCalledWith(fs, "/repo", HELP_EXEMPT_FLAG);
    expect(HELP_EXEMPT_FLAG).toBe("gated-help-exempt");
  });

  it("is false when the local overlay leaves the flag off", async () => {
    vi.mocked(localFlagOn).mockResolvedValue(false);
    expect(
      await helpExemptOn(fs, "/repo", {
        tool_name: "Bash",
        tool_input: {
          command: "node skills/bin/harness.mjs flag activate --help",
        },
      }),
    ).toBe(false);
  });

  it.each([
    ["a file tool", { tool_name: "Read", tool_input: { file_path: "--help" } }],
    [
      "a Bash call with no help flag",
      { tool_name: "Bash", tool_input: { command: "ls docs" } },
    ],
    ["a call with no input", { tool_name: "Bash" }],
  ])("is false, and reads no flag, for %s", async (_label, call) => {
    expect(await helpExemptOn(fs, "/repo", call)).toBe(false);
    expect(localFlagOn).not.toHaveBeenCalled();
  });
});
