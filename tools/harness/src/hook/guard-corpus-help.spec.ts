// The help-request corpus is data: the spec keeps each list named, the allowed list free of any
// form the exemption must still refuse, and every refusal under the gated rule.

import { describe, expect, it } from "vitest";
import {
  HELP_ALLOWED,
  HELP_REFUSED_FLAG_OFF,
  HELP_STILL_REFUSED,
} from "./guard-corpus-help.js";

describe("help-request corpus data", () => {
  it("refuses every help request under the gated rule while the flag is off", () => {
    expect(
      HELP_REFUSED_FLAG_OFF.filter((c) => c.rule !== "role-no-merge"),
    ).toEqual([]);
    expect(HELP_REFUSED_FLAG_OFF.length).toBeGreaterThan(0);
  });

  it("holds no still-refused form in the allowed list", () => {
    const refused = HELP_STILL_REFUSED.map((c) => c.input);
    expect(HELP_ALLOWED.filter((c) => refused.includes(c.input))).toEqual([]);
  });

  it("names every still-refused form under the gated rule, for the writer", () => {
    expect(
      HELP_STILL_REFUSED.filter(
        (c) => c.rule !== "role-no-merge" || c.role !== "writer",
      ),
    ).toEqual([]);
    expect(HELP_STILL_REFUSED.length).toBeGreaterThan(0);
  });
});
