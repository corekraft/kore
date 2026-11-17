import { describe, expect, it } from "vitest";
import { KINDS } from "./schema-kinds.js";

describe("the ledger event kinds", () => {
  it("lists each kind once, so a kind added twice is caught", () => {
    expect(new Set(KINDS).size).toBe(KINDS.length);
  });

  it("lists owner.asked, the event a session writes each time it puts a question to the owner (#859)", () => {
    expect(KINDS).toContain("owner.asked");
  });

  it("lists decision.digest, the owner digest's record of when it was posted, and decision.blocking, the tick's mark on an idea whose owner question blocks it (ADR 0120, #878)", () => {
    expect(KINDS).toEqual(
      expect.arrayContaining(["decision.digest", "decision.blocking"]),
    );
  });

  it("still accepts the kinds older events were written with, and the review run's", () => {
    expect(KINDS).toEqual(
      expect.arrayContaining(["challenge.round", "send-back", "review.run"]),
    );
  });
});
