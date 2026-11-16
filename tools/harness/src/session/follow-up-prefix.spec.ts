import { describe, expect, it } from "vitest";
import { FOLLOW_UP_PREFIX } from "./follow-up-prefix.js";

describe("the legacy follow-up prefix", () => {
  it("keeps the literal text past transcripts carry, for the retro scan to keep reading", () => {
    expect(FOLLOW_UP_PREFIX).toBe("[orchestrator]");
  });
});
