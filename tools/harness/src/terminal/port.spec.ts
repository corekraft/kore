import { describe, expect, it } from "vitest";
import { terminalError } from "./port.js";

describe("terminalError", () => {
  it("builds the structured error, with its hint, that a port method returns", () => {
    expect(
      terminalError("not-found", "no terminal t9", "run hc ls --all"),
    ).toEqual({
      error: {
        kind: "not-found",
        message: "no terminal t9",
        hint: "run hc ls --all",
      },
    });
  });

  it("leaves the hint out when none is given, so the error has exactly kind and message", () => {
    const error = terminalError("timeout", "waited 0 ms");
    expect(error).toEqual({
      error: { kind: "timeout", message: "waited 0 ms" },
    });
    expect(Object.keys(error.error)).toEqual(["kind", "message"]);
  });
});
