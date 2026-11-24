import { describe, expect, it } from "vitest";
import { sha256Digest } from "./digest.js";

describe("sha256Digest", () => {
  it("writes the sha256 of the text as sha256: and 64 hex digits", () => {
    expect(sha256Digest("abc")).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("gives the same digest for the same text and another for a changed one", () => {
    expect(sha256Digest("a")).toBe(sha256Digest("a"));
    expect(sha256Digest("a")).not.toBe(sha256Digest("a "));
  });
});
