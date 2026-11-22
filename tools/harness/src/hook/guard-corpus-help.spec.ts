// The help-request corpus is data: the spec keeps each list named, the allowed list free of any
// form the exemption must still refuse, and every refusal under the gated rule.

import { describe, expect, it } from "vitest";
import {
  HELP_ALLOWED,
  HELP_LEVELS_ORDINARY,
  HELP_NEAR_MISS_REFUSED,
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

  it("gives every role each help level, and the read-only roles the gated pair's help (#1802)", () => {
    const inputs = (role: string) =>
      HELP_LEVELS_ORDINARY.filter((c) => c.role === role).map((c) => c.input);
    const levels = [
      "node skills/bin/harness.mjs --help",
      "node skills/bin/harness.mjs -h",
      "node skills/bin/harness.mjs --help --json",
      "node skills/bin/harness.mjs flag --help",
      "node skills/bin/harness.mjs flow report --help --json",
      "node skills/bin/harness.mjs judge merge -h",
      "node skills/bin/harness.mjs judge approve --help --json",
    ];
    const gated = [
      "node skills/bin/harness.mjs flag activate --help",
      "node skills/bin/harness.mjs outcome record -h --json",
    ];
    expect(inputs("writer")).toEqual(levels);
    expect(inputs("reader")).toEqual([...levels, ...gated]);
    expect(inputs("judge")).toEqual([...levels, ...gated]);
  });

  it("refuses each help near-miss for the read-only roles and the judge, as role-read-only (#1802)", () => {
    expect(new Set(HELP_NEAR_MISS_REFUSED.map((c) => c.role))).toEqual(
      new Set(["judge", "judgment", "principles-review", "reader"]),
    );
    expect(
      HELP_NEAR_MISS_REFUSED.filter((c) => c.rule !== "role-read-only"),
    ).toEqual([]);
  });

  it("holds no near-miss in the help-levels list", () => {
    const refused = HELP_NEAR_MISS_REFUSED.map((c) => c.input);
    expect(
      HELP_LEVELS_ORDINARY.filter((c) => refused.includes(c.input)),
    ).toEqual([]);
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
