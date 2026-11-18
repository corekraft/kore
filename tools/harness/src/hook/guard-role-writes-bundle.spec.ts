// The bundle's help request as the guard reads a command line (#973): the shell parse is mocked,
// with the plain-line meaning of commandOf; the bundle path is a constant, so it is real.

import { basename } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bundleHelpRequest } from "./guard-role-writes.js";
import { commandOf } from "./guard-shell.js";

vi.mock("./guard-role-reads.js");
vi.mock("./guard-shell.js");
vi.mock("./guard-verdict.js");

beforeEach(() => {
  // The shell parse of a plain line: the name is the first word's basename, the arguments the rest.
  vi.mocked(commandOf).mockImplementation((tokens) => ({
    name: basename(tokens[0] ?? ""),
    args: tokens.slice(1),
  }));
});

describe("bundleHelpRequest: the bundle, then its gated words and exactly one help flag", () => {
  it.each([
    [
      "node run by its path",
      ["node", "skills/bin/harness.mjs", "flag", "activate", "--help"],
    ],
    [
      "node run with -h",
      ["node", "skills/bin/harness.mjs", "outcome", "record", "-h"],
    ],
    [
      "node with a ./ path",
      ["node", "./skills/bin/harness.mjs", "flag", "activate", "--help"],
    ],
    [
      "the bundle run directly by its path",
      ["skills/bin/harness.mjs", "flag", "activate", "--help"],
    ],
  ])("is true for %s", (_label, line) => {
    expect(bundleHelpRequest(line)).toBe(true);
  });

  it.each([
    [
      "a gated word after the help flag",
      ["node", "skills/bin/harness.mjs", "flag", "activate", "x", "--help"],
    ],
    ["no help flag", ["node", "skills/bin/harness.mjs", "flag", "activate"]],
    [
      "a word after the help flag",
      [
        "node",
        "skills/bin/harness.mjs",
        "flag",
        "activate",
        "--help",
        "--json",
      ],
    ],
    ["a program named harness", ["harness", "flag", "activate", "--help"]],
    [
      "a bundle of another path",
      ["node", "/tmp/harness.mjs", "flag", "activate", "--help"],
    ],
    [
      "the launcher, not the bundle",
      ["bash", ".claude/hooks/harness.sh", "flag", "activate", "--help"],
    ],
    [
      "a node flag before the bundle",
      [
        "node",
        "--no-warnings",
        "skills/bin/harness.mjs",
        "flag",
        "activate",
        "--help",
      ],
    ],
    [
      "a bundle run directly by another path",
      ["/tmp/harness.mjs", "flag", "activate", "--help"],
    ],
    ["another program's help", ["gh", "workflow", "run", "--help"]],
  ])("is false for %s", (_label, line) => {
    expect(bundleHelpRequest(line)).toBe(false);
  });
});
