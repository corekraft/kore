import { describe, expect, it } from "vitest";
import { JudgeError } from "./errors.js";

describe("JudgeError", () => {
  it("is an Error that keeps the message the caller reads", () => {
    const error = new JudgeError("gh pr view failed for PR #42");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("gh pr view failed for PR #42");
  });

  it("is told apart from a plain Error, so a caller can catch only judge failures", () => {
    expect(new Error("unrelated")).not.toBeInstanceOf(JudgeError);
  });
});
