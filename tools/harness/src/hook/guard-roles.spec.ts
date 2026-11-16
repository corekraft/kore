import { describe, expect, it } from "vitest";
import {
  DELIVERY_ROLES,
  GUARD_ROLES,
  NO_CODE_ROLES,
  READ_ONLY_ROLES,
  REPORTING_ROLES,
  SPAWNED_ROLES,
} from "./guard-roles.js";

describe("guard role registry", () => {
  it("names neither the orchestrator nor the concierge, which no agent fills", () => {
    expect(GUARD_ROLES).not.toContain("orchestrator");
    expect(GUARD_ROLES).not.toContain("concierge");
  });

  it("names neither the refiner nor the challenger, which are retired", () => {
    expect(GUARD_ROLES).not.toContain("refiner");
    expect(GUARD_ROLES).not.toContain("challenger");
  });

  it("lists the four guard roles once, in order", () => {
    expect(GUARD_ROLES).toEqual([
      "reader",
      "principles-review",
      "judge",
      "writer",
    ]);
  });

  it("keeps every group inside the registry, so no group names a role the registry lacks", () => {
    const registered = new Set<string>(GUARD_ROLES);
    for (const group of [
      READ_ONLY_ROLES,
      NO_CODE_ROLES,
      SPAWNED_ROLES,
      REPORTING_ROLES,
    ]) {
      expect(group.filter((role) => !registered.has(role))).toEqual([]);
    }
  });

  it("names the delivery roles: the reporting roles and the writer", () => {
    expect([...DELIVERY_ROLES]).toEqual(["judge", "writer"]);
  });

  it("names the read-only, no-code, spawned and reporting groups the guard rules bound", () => {
    expect(READ_ONLY_ROLES).toEqual(["reader", "principles-review"]);
    expect(NO_CODE_ROLES).toEqual([]);
    expect(SPAWNED_ROLES).toEqual(["reader", "principles-review"]);
    expect(REPORTING_ROLES).toEqual(["judge"]);
  });
});
