import { describe, expect, it } from "vitest";
import { CommandError } from "./errors.js";

describe("CommandError", () => {
  it("is an Error, so a catch can tell an expected failure by its class", () => {
    const error = new CommandError("no repo root");
    expect(error).toBeInstanceOf(CommandError);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("no repo root");
  });
});
