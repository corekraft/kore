import { describe, expect, it } from "vitest";
import { roleCoverage } from "./guard-role-coverage.js";

describe("roleCoverage", () => {
  it("reports a registry role that no spec case names as missing", () => {
    expect(roleCoverage(["concierge", "judge"], ["concierge"])).toEqual({
      missing: ["judge"],
      extra: [],
    });
  });

  it("reports a spec role the registry lacks as extra", () => {
    expect(roleCoverage(["concierge"], ["concierge", "ghost"])).toEqual({
      missing: [],
      extra: ["ghost"],
    });
  });

  it("reports nothing when the spec cases name exactly the registry's roles", () => {
    expect(roleCoverage(["judge", "writer"], ["writer", "judge"])).toEqual({
      missing: [],
      extra: [],
    });
  });

  it("reports both kinds at once, sorted, and counts a role a spec names twice once", () => {
    expect(
      roleCoverage(["writer", "judge"], ["zeta", "zeta", "alpha"]),
    ).toEqual({
      missing: ["judge", "writer"],
      extra: ["alpha", "zeta"],
    });
  });
});
