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
  it("lists the seven guard roles once, in order", () => {
    expect(GUARD_ROLES).toEqual([
      "concierge",
      "reader",
      "refiner",
      "challenger",
      "orchestrator",
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
    expect([...DELIVERY_ROLES]).toEqual(["orchestrator", "judge", "writer"]);
  });

  it("names the read-only, no-code, spawned and reporting groups the guard rules bound", () => {
    expect(READ_ONLY_ROLES).toEqual([
      "concierge",
      "reader",
      "refiner",
      "challenger",
    ]);
    expect(NO_CODE_ROLES).toEqual(["concierge", "challenger"]);
    expect(SPAWNED_ROLES).toEqual(["reader", "refiner", "challenger"]);
    expect(REPORTING_ROLES).toEqual(["orchestrator", "judge"]);
  });
});
