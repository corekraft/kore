import { describe, expect, it } from "vitest";
import { IdeaError } from "./error.js";

describe("IdeaError", () => {
  it("is an Error that keeps the message the caller reads", () => {
    const error = new IdeaError("docs/ideas/0001-a.md has no frontmatter");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("docs/ideas/0001-a.md has no frontmatter");
  });

  it("is told apart from a plain Error, so a caller can catch only idea failures", () => {
    expect(new Error("unrelated")).not.toBeInstanceOf(IdeaError);
  });
});
