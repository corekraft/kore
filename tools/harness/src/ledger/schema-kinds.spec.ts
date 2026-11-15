import { describe, expect, it } from "vitest";
import { KINDS } from "./schema-kinds.js";

describe("the ledger event kinds", () => {
  it("lists each kind once, so a kind added twice is caught", () => {
    expect(new Set(KINDS).size).toBe(KINDS.length);
  });

  it("still accepts the kinds older events were written with, and the review run's", () => {
    expect(KINDS).toEqual(
      expect.arrayContaining(["challenge.round", "send-back", "review.run"]),
    );
  });
});
