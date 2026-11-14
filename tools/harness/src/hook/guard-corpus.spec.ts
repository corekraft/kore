// The bypass corpus is data: every attempt names the rule it must trip, and the corpus does not shrink silently. The cases run through the hook in integration/hook/guard-corpus.spec.ts.

import { describe, expect, it } from "vitest";
import { CORPUS, ORDINARY } from "./guard-corpus.js";

describe("bypass corpus data", () => {
  it("names the rule every attempt must trip, and leaves no rule name empty", () => {
    expect(CORPUS.filter((c) => c.rule.trim() === "")).toEqual([]);
  });

  it("keeps a corpus large enough that a shrinking one fails loudly", () => {
    expect(CORPUS.length).toBeGreaterThan(250);
  });

  it("keeps every ordinary call a call with a command or path to run", () => {
    expect(ORDINARY.filter((c) => c.input.trim() === "")).toEqual([]);
  });
});
