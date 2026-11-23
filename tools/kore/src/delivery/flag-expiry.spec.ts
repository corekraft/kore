import { expect, test } from "vitest";
import type { FlagDeclaration } from "./flags-manifest.js";
import { expiredFlags, expiryWarnings } from "./flag-expiry.js";

const flag = (name: string, expiry: string): FlagDeclaration => ({
  name,
  default: false,
  owner: "checkout-team",
  safetyPattern: "feature-flagged",
  expiry,
  rollout: { kind: "flag", criteria: ["errors-low"], soakHours: 4 },
});

test("a flag past its expiry yields a warning that names the flag and its date", () => {
  const flags = [flag("leads.old-path", "2026-10-01")];
  expect(expiryWarnings(flags, "2026-11-23")).toEqual([
    "flag leads.old-path expired on 2026-10-01; retire it or extend its expiry",
  ]);
  expect(expiredFlags(flags, "2026-11-23")).toEqual(["leads.old-path"]);
});

test("a flag that expires today is not yet past its expiry", () => {
  const flags = [flag("leads.new-checkout", "2026-11-23")];
  expect(expiryWarnings(flags, "2026-11-23")).toEqual([]);
  expect(expiredFlags(flags, "2026-11-23")).toEqual([]);
});

test("only the flags past their expiry are named, in the order declared", () => {
  const flags = [
    flag("leads.later", "2027-01-01"),
    flag("leads.first", "2026-01-15"),
    flag("leads.second", "2026-03-01"),
  ];
  expect(expiredFlags(flags, "2026-11-23")).toEqual([
    "leads.first",
    "leads.second",
  ]);
});
