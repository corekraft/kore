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

// hc 0.1.21 prints its structured error on stdout, with exit code 1, 3, 7 or 11.
const printed: [
  name: string,
  stdout: string,
  code: number,
  expected: unknown,
][] = [
  [
    "not_found",
    HC_0_1_21.errors.notFound,
    3,
    {
      error: {
        kind: "not-found",
        message: 'no terminal "nope"',
        hint: "see `hc ls --all`",
      },
    },
  ],
  [
    "name_taken",
    HC_0_1_21.errors.nameTaken,
    1,
    {
      error: {
        kind: "name-taken",
        message: 'a live terminal is already named "s3"',
        hint: "pick another name, or kill the one holding it",
      },
    },
  ],
  [
    "live",
    HC_0_1_21.errors.live,
    1,
    {
      error: {
        kind: "still-live",
        message: "t4 is still running",
        hint: "kill it first: hc kill t4",
      },
    },
  ],
  [
    "finished",
    HC_0_1_21.errors.finished,
    11,
    {
      error: {
        kind: "not-live",
        message: "t3 has finished",
        hint: "hc read t3",
      },
    },
  ],
  [
    "needs_target, which the port does not name",
    HC_0_1_21.errors.needsTarget,
    7,
    {
      error: {
        kind: "unavailable",
        message: "whose children?",
        hint: "run it inside a terminal, or name the parent",
      },
    },
  ],
];

describe("hcFailure", () => {
  it.each(printed)(
    "maps hc's %s error, printed on stdout, to the port's kind, with hc's message and hint",
    (_name, stdout, code, expected) => {
      expect(hcFailure("get", { stdout, stderr: "", code })).toEqual(expected);
    },
  );

  it("still reads a structured error that hc printed on stderr", () => {
    expect(hcFailure("get", failed(3, HC_0_1_21.errors.notFound))).toEqual({
      error: {
        kind: "not-found",
        message: 'no terminal "nope"',
        hint: "see `hc ls --all`",
      },
    });
  });

  it("names the command and exit code when no structured error is printed, in hc's own words", () => {
    expect(hcFailure("get", failed(2, "boom\n"))).toEqual({
      error: {
        kind: "unavailable",
        message: "hc get exited with code 2: boom",
      },
    });
  });

  it("does not read JSON that has no error as a structured error", () => {
    expect(
      hcFailure("get", { stdout: "", stderr: '{"ok":true}', code: 2 }),
    ).toEqual({
      error: {
        kind: "unavailable",
        message: 'hc get exited with code 2: {"ok":true}',
      },
    });
  });
});
