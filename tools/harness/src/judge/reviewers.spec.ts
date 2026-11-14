import { describe, expect, it } from "vitest";
import { JudgeError } from "./errors.js";
import { reviewersFor } from "./reviewers.js";

describe("judge reviewers with no flag", () => {
  it("trusts the configured owner login when no list is configured", () => {
    expect(reviewersFor({ owner: "junners" })).toEqual(["junners"]);
  });

  it("trusts only the reviewerLogins list when one is configured", () => {
    expect(
      reviewersFor({ owner: "junners", configured: ["bot-a", "bot-b"] }),
    ).toEqual(["bot-a", "bot-b"]);
  });

  it("falls back to the owner login when the configured list is empty", () => {
    expect(reviewersFor({ owner: "junners", configured: [] })).toEqual([
      "junners",
    ]);
  });
});

describe("judge reviewers with --reviewer", () => {
  it("overrides the configured list and the owner login", () => {
    expect(
      reviewersFor({
        flag: "someone-else",
        owner: "junners",
        configured: ["bot-a"],
      }),
    ).toEqual(["someone-else"]);
  });

  it("splits a comma-separated flag into logins, trimming blanks", () => {
    expect(reviewersFor({ flag: " a , b,,c ", owner: "junners" })).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("refuses a flag that names no login, so a typo never silently widens or narrows trust", () => {
    expect(() => reviewersFor({ flag: " , ", owner: "junners" })).toThrow(
      JudgeError,
    );
  });
});
