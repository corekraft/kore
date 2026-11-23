import { describe, expect, it } from "vitest";
import { describeFailure } from "./describe-failure.js";

describe("describeFailure: what a failed command said, for an error message", () => {
  it("gives its stderr, trimmed, when it wrote some", () => {
    expect(
      describeFailure({ stdout: "out", stderr: "  no such pane \n", code: 1 }),
    ).toBe("no such pane");
  });

  it("gives its stdout when stderr is empty", () => {
    expect(describeFailure({ stdout: "gone\n", stderr: "", code: 2 })).toBe(
      "gone",
    );
  });

  it("gives the exit code when it wrote on neither stream", () => {
    expect(describeFailure({ stdout: " ", stderr: "", code: 7 })).toBe(
      "exit code 7",
    );
  });
});
