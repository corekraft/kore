import { describe, expect, it, vi } from "vitest";
import { HC_0_1_21 } from "./hc-0.1.21.fixtures.js";
import { hcFailure } from "./hc-errors.js";
import { failed } from "./hc-terminals-support.js";

// terminalError is a function with behaviour, so it is a double (ADR 0098).
vi.mock("./port.js", () => ({
  terminalError: vi.fn((kind: string, message: string, hint?: string) => ({
    error: { kind, message, hint },
  })),
}));

const structured: [name: string, stderr: string, expected: unknown][] = [
  [
    "not_found",
    HC_0_1_21.errors.notFound,
    {
      error: {
        kind: "not-found",
        message: "no terminal t9",
        hint: "list the terminals with hc ls --all",
      },
    },
  ],
  [
    "status_mismatch",
    HC_0_1_21.errors.statusMismatch,
    {
      error: {
        kind: "status-mismatch",
        message: "t7 is working, not idle",
        hint: "wait until it is idle, then send",
      },
    },
  ],
  [
    "live",
    HC_0_1_21.errors.live,
    {
      error: {
        kind: "still-live",
        message: "t7 is still live",
        hint: "end it first with hc kill t7",
      },
    },
  ],
  [
    "finished",
    HC_0_1_21.errors.finished,
    {
      error: {
        kind: "not-live",
        message: "t7 has finished",
        hint: "start a new terminal instead",
      },
    },
  ],
  [
    "name_taken",
    HC_0_1_21.errors.nameTaken,
    {
      error: {
        kind: "name-taken",
        message: "a live terminal is already named s1",
        hint: "pick another name",
      },
    },
  ],
  [
    "invalid_params",
    JSON.stringify({
      error: {
        kind: "invalid_params",
        message: "bad flag",
        hint: "see hc run --help",
      },
    }),
    {
      error: {
        kind: "invalid-spec",
        message: "bad flag",
        hint: "see hc run --help",
      },
    },
  ],
  [
    "blocked, which the port does not name",
    HC_0_1_21.errors.blocked,
    {
      error: {
        kind: "unavailable",
        message: "t7 is blocked on a permission",
        hint: "read it with hc read t7",
      },
    },
  ],
];

describe("hcFailure", () => {
  it.each(structured)(
    "maps hc's %s error to the port's kind, with hc's message and hint",
    (_name, stderr, expected) => {
      expect(hcFailure("get", failed(3, stderr))).toEqual(expected);
    },
  );

  it("names the command and exit code when stderr has no structured error, in hc's own words", () => {
    expect(hcFailure("get", failed(2, "boom\n"))).toEqual({
      error: {
        kind: "unavailable",
        message: "hc get exited with code 2: boom",
      },
    });
  });

  it("does not read JSON on stderr that has no error as a structured error", () => {
    expect(hcFailure("get", failed(2, '{"ok":true}'))).toEqual({
      error: {
        kind: "unavailable",
        message: 'hc get exited with code 2: {"ok":true}',
      },
    });
  });
});
