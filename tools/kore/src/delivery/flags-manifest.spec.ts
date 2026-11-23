import { expect, test } from "vitest";
import { parseFlagsManifest } from "./flags-manifest.js";

// flags.yaml is JSON-compatible YAML (AGENTS.md): these tests write JSON text.
const flag = (overrides: Record<string, unknown> = {}) => ({
  name: "leads.new-checkout",
  default: false,
  owner: "checkout-team",
  safetyPattern: "feature-flagged",
  expiry: "2027-06-30",
  rollout: {
    kind: "flag",
    criteria: ["checkout-errors-below-0.5-percent"],
    soakHours: 4,
  },
  ...overrides,
});

const manifestText = (flags: unknown[] = [flag()]) =>
  JSON.stringify({ service: "leads", flags });

test("a manifest of the service prefix with default-off flags parses with no failures", () => {
  const result = parseFlagsManifest(manifestText());
  expect(result.failures).toEqual([]);
  expect(result.manifest).toEqual({
    service: "leads",
    flags: [flag()],
  });
});

test("an empty flag list is a valid manifest for an app with no flags", () => {
  const result = parseFlagsManifest(manifestText([]));
  expect(result.failures).toEqual([]);
  expect(result.manifest).toEqual({ service: "leads", flags: [] });
});

test("a flag whose default is on is refused, so a release ships every flag off", () => {
  const result = parseFlagsManifest(manifestText([flag({ default: true })]));
  expect(result.manifest).toBeUndefined();
  expect(result.failures).toEqual([
    "flag leads.new-checkout: default must be false; every flag ships off",
  ]);
});

test("a flag name without the service prefix is refused", () => {
  const result = parseFlagsManifest(
    manifestText([flag({ name: "checkout.new-flow" })]),
  );
  expect(result.failures).toEqual([
    'flag checkout.new-flow: name must start with the service prefix "leads."',
  ]);
});

test("a flag name with nothing after the service prefix is refused", () => {
  const result = parseFlagsManifest(manifestText([flag({ name: "leads." })]));
  expect(result.failures).toEqual([
    'flag leads.: the part after "leads." must be lowercase letters, digits and hyphens',
  ]);
});

test("a flag without a rollout is refused, since the platform cannot judge it", () => {
  const { rollout: _rollout, ...withoutRollout } = flag();
  const result = parseFlagsManifest(manifestText([withoutRollout]));
  expect(result.failures).toEqual([
    "flag leads.new-checkout has no rollout; a flag needs a kind, criteria and a soak window",
  ]);
});

test.each([
  [
    "a rollout with no soak window",
    { kind: "flag", criteria: ["errors-low"] },
    "flag leads.new-checkout: rollout.soakHours must be a whole number of hours, at least 1",
  ],
  [
    "a rollout with a soak window of zero hours",
    { kind: "flag", criteria: ["errors-low"], soakHours: 0 },
    "flag leads.new-checkout: rollout.soakHours must be a whole number of hours, at least 1",
  ],
  [
    "a rollout with no criteria",
    { kind: "flag", criteria: [], soakHours: 4 },
    "flag leads.new-checkout: rollout.criteria must name at least one criterion, as a list of strings",
  ],
  [
    "a rollout kind the platform does not know",
    { kind: "percentage", criteria: ["errors-low"], soakHours: 4 },
    "flag leads.new-checkout: rollout.kind must be flag, canary or dark-launch",
  ],
])("a flag with %s is refused", (_label, rollout, failure) => {
  const result = parseFlagsManifest(manifestText([flag({ rollout })]));
  expect(result.failures).toEqual([failure]);
});

test("a canary rollout is recognised in the manifest, since the platform refuses it later, not the eval", () => {
  const rollout = { kind: "canary", criteria: ["errors-low"], soakHours: 4 };
  const result = parseFlagsManifest(manifestText([flag({ rollout })]));
  expect(result.failures).toEqual([]);
});

test("a flag with no owner is refused", () => {
  const result = parseFlagsManifest(manifestText([flag({ owner: "" })]));
  expect(result.failures).toEqual([
    "flag leads.new-checkout: owner must name who owns the flag",
  ]);
});

test("a flag whose safety pattern is not one of the four is refused", () => {
  const result = parseFlagsManifest(
    manifestText([flag({ safetyPattern: "branch-by-abstraction" })]),
  );
  expect(result.failures).toEqual([
    "flag leads.new-checkout: safetyPattern must be one of no-behaviour-change, feature-flagged, dark-launched, expand-contract",
  ]);
});

test.each(["next-week", "2026-02-31", "2026-6-1"])(
  "a flag whose expiry is %s is refused: an expiry is a real date as YYYY-MM-DD",
  (expiry) => {
    const result = parseFlagsManifest(manifestText([flag({ expiry })]));
    expect(result.failures).toEqual([
      "flag leads.new-checkout: expiry must be a date as YYYY-MM-DD",
    ]);
  },
);

test("a misspelt key on a flag is refused rather than silently ignored", () => {
  const result = parseFlagsManifest(
    manifestText([flag({ defualt: false, default: undefined })]),
  );
  expect(result.failures).toEqual([
    'flag leads.new-checkout: unknown key "defualt"; allowed keys are name, default, owner, safetyPattern, expiry, rollout',
    "flag leads.new-checkout: default must be false; every flag ships off",
  ]);
});

test("two flags with the same name are refused", () => {
  const result = parseFlagsManifest(manifestText([flag(), flag()]));
  expect(result.failures).toEqual([
    "flag leads.new-checkout is declared more than once",
  ]);
});

test("a service name that is not lowercase letters, digits and hyphens is refused", () => {
  const result = parseFlagsManifest(
    JSON.stringify({ service: "Leads", flags: [] }),
  );
  expect(result.failures).toEqual([
    "service must be a lowercase name of letters, digits and hyphens, such as leads",
  ]);
});

test("text that is not JSON is refused, with the YAML rule named", () => {
  const result = parseFlagsManifest("service: leads\nflags: []\n");
  expect(result.manifest).toBeUndefined();
  expect(result.failures).toHaveLength(1);
  expect(result.failures[0]).toMatch(
    /^flags\.yaml is not JSON-compatible YAML \(.+\); write it in JSON syntax, which YAML accepts$/,
  );
});

test("every failure in one manifest is reported together, not only the first", () => {
  const result = parseFlagsManifest(
    manifestText([flag({ default: true, owner: "" })]),
  );
  expect(result.failures).toEqual([
    "flag leads.new-checkout: default must be false; every flag ships off",
    "flag leads.new-checkout: owner must name who owns the flag",
  ]);
});
