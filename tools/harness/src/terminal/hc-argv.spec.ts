import { describe, expect, it, vi } from "vitest";
import { refuseRun } from "./hc-argv.js";
import type { RunSpec } from "./port.js";

// terminalError is a function with behaviour, so it is a double (ADR 0098).
vi.mock("./port.js", () => ({
  terminalError: vi.fn((kind: string, message: string, hint?: string) => ({
    error: { kind, message, hint },
  })),
}));

const refusals: [name: string, spec: RunSpec, expected: unknown][] = [
  [
    "a per-terminal env with a secret in it",
    { argv: ["claude"], cwd: "/w", env: { GH_TOKEN: "ghs_secret" } },
    {
      error: {
        kind: "invalid-spec",
        message:
          "hc run cannot set a terminal's env, and a secret never goes in argv",
        hint: "pass no env: the launch wrapper inside the terminal makes the role's token (plan 16, Decisions 6)",
      },
    },
  ],
  [
    "an empty argv, which would start the machine's own shell",
    { argv: [], cwd: "/w" },
    {
      error: {
        kind: "invalid-spec",
        message: "hc run needs a program to start",
        hint: "pass the program as argv[0]",
      },
    },
  ],
  [
    "one argv element with whitespace or a shell sign, which hc would run as sh -c",
    { argv: ["cd app && make"], cwd: "/w" },
    {
      error: {
        kind: "invalid-spec",
        message: 'hc would run "cd app && make" through sh -c',
        hint: "pass the program and each argument as its own argv element",
      },
    },
  ],
  [
    "an argv element over 128 KiB, which the kernel does not accept",
    { argv: ["claude", "x".repeat(128 * 1024 + 1)], cwd: "/w" },
    {
      error: {
        kind: "invalid-spec",
        message:
          "an argv element is 131073 bytes, over the 131072-byte limit for one argument",
        hint: "write the brief to a file and pass its path (plan 16, Step 3)",
      },
    },
  ],
];

const accepted: [name: string, spec: RunSpec][] = [
  [
    "a program with arguments and no shell sign",
    { argv: ["claude", "--agent", "writer", "brief text"], cwd: "/w" },
  ],
  ["an empty env, which sets nothing", { argv: ["bash"], cwd: "/w", env: {} }],
  [
    "an argv element of exactly 128 KiB",
    { argv: ["claude", "x".repeat(128 * 1024)], cwd: "/w" },
  ],
];

describe("refuseRun", () => {
  it.each(refusals)("refuses %s", (_name, spec, expected) => {
    expect(refuseRun(spec)).toEqual(expected);
  });

  it.each(accepted)("accepts %s", (_name, spec) => {
    expect(refuseRun(spec)).toBeUndefined();
  });
});
