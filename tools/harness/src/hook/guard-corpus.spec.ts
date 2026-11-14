// The bypass corpus is data: every attempt names the rule it must trip, and the corpus does not shrink silently. The cases run through the hook in integration/hook/guard-corpus.spec.ts.

import { describe, expect, it } from "vitest";
import { CORPUS, ORDINARY } from "./guard-corpus.js";
import { GUARD_ROLES } from "./guard-roles.js";
import { roleCoverage } from "./guard-role-coverage.js";

describe("bypass corpus data", () => {
  it("names every guard role in the registry, and no role the registry lacks", () => {
    const specRoles = [...CORPUS, ...ORDINARY].flatMap((c) =>
      c.role === undefined ? [] : [c.role],
    );

    expect(roleCoverage(GUARD_ROLES, specRoles)).toEqual({
      missing: [],
      extra: [],
    });
  });

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
