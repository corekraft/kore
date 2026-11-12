import { describe, expect, it } from "vitest";
import { sessionNameError } from "./names.js";

describe("session names", () => {
  it.each([
    "image-trust-reader",
    "postgresql_api_fixer",
    "gateway-tls-verifier",
    "a".repeat(32),
    "retro-2026",
  ])("accepts %s", (name) => {
    expect(sessionNameError(name)).toBeUndefined();
  });

  it("rejects a name over 32 characters and names the limit and the fix", () => {
    const error = sessionNameError("portability-validation-implementer");
    expect(error).toContain("34 characters");
    expect(error).toContain("at most 32");
    expect(error).toContain("shorten");
  });

  it.each(["Reader", "reader.a", "reader a", "", "reader/x"])(
    "rejects %j for characters outside lowercase letters, digits, - and _",
    (name) => {
      expect(sessionNameError(name)).toContain("lowercase letters");
    },
  );

  it.each([
    "reader-a",
    "verifier-2",
    "step8-verifier",
    "first-reader",
    "reader_third",
    "writer-2nd",
    "7",
  ])(
    "rejects the letter, ordinal or step-number name %s with the fix",
    (name) => {
      const error = sessionNameError(name);
      expect(error).toContain("subject");
      expect(error).toContain("image-trust-reader");
    },
  );
});
