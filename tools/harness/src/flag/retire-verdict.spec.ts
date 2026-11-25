// Docs: docs/decisions/0149-a-feature-flag-retires-after-it-soaks-on-in-every-environment-it-applies-to.md
import { describe, expect, it } from "vitest";
import type { ManifestEntry } from "./manifest.js";
import {
  retirementEnvironments,
  retireRefusals,
  type RetireEnvironment,
  type RetireFacts,
} from "./retire-verdict.js";

const FLAG = "suborg-tenancy";
const DAY = 86_400_000;
const LATEST = "2026-11-01T00:00:00.000Z";
const LATEST_MS = Date.parse(LATEST);
const SOAK = 14;

/** A feature flag that applies to local and vps, with no not-applicable marks. */
const ENTRY: ManifestEntry = {
  name: FLAG,
  kind: "feature",
  applies: ["local", "vps"],
  requires: [],
  pending: false,
  notApplicable: [],
};

/** An environment the flag is on in, proven, and activated at LATEST. */
const soaked = (name: string): RetireEnvironment => ({
  name,
  hasOverlay: true,
  on: true,
  proven: true,
  activated: LATEST,
});

/** Facts for an eligible flag once the soak has elapsed, with no revert; override any field. */
function facts(overrides: Partial<RetireFacts> = {}): RetireFacts {
  return {
    flag: FLAG,
    entry: ENTRY,
    environments: [soaked("local"), soaked("vps")],
    reverts: [],
    soakDays: SOAK,
    now: new Date(LATEST_MS + SOAK * DAY),
    ...overrides,
  };
}

describe("retireRefusals: the flag and each environment it applies to", () => {
  it("accepts a feature flag on, proven and activated in every environment it applies to, once the soak elapsed", () => {
    expect(retireRefusals(facts())).toEqual([]);
  });

  it("refuses a flag the manifest does not declare, since there is no entry to retire", () => {
    expect(retireRefusals(facts({ entry: undefined }))).toEqual([
      `${FLAG} is not declared in infra/catalog/flags.yaml, so it has no entry to retire`,
    ]);
  });

  it.each(["environment", "harness"] as const)(
    "refuses a %s flag, which is never retired (ADR 0149)",
    (kind) => {
      expect(retireRefusals(facts({ entry: { ...ENTRY, kind } }))).toEqual([
        `${FLAG} is a ${kind} flag; only a feature flag retires (ADR 0149)`,
      ]);
    },
  );

  it("refuses a flag that is off in an environment, naming it", () => {
    const environments = [soaked("local"), { ...soaked("vps"), on: false }];
    expect(retireRefusals(facts({ environments }))).toEqual([
      `${FLAG} is off in vps`,
    ]);
  });

  it("refuses an environment with no overlay to read the flag from", () => {
    const environments = [
      soaked("local"),
      { ...soaked("vps"), hasOverlay: false },
    ];
    expect(retireRefusals(facts({ environments }))).toEqual([
      "vps has no environment overlay to read suborg-tenancy from",
    ]);
  });

  it("refuses a flag with no recorded outcome in an environment", () => {
    const environments = [soaked("local"), { ...soaked("vps"), proven: false }];
    expect(retireRefusals(facts({ environments }))).toEqual([
      `${FLAG} has no recorded outcome in vps`,
    ]);
  });

  it("refuses a flag with no recorded activation in an environment, so there is no soak to read", () => {
    const environments = [
      soaked("local"),
      { ...soaked("vps"), activated: undefined },
    ];
    expect(retireRefusals(facts({ environments }))).toEqual([
      `${FLAG} has no recorded activation in vps`,
    ]);
  });
});

describe("retireRefusals: the soak, the reverts and the environments it skips", () => {
  it("refuses while the soak after the latest activation has not elapsed, naming when it ends", () => {
    const now = new Date(LATEST_MS + (SOAK - 1) * DAY);
    expect(retireRefusals(facts({ now }))).toEqual([
      "the soak after 2026-11-01T00:00:00.000Z ends 2026-11-15T00:00:00.000Z and has not elapsed",
    ]);
  });

  it("accepts a flag the moment its soak ends", () => {
    const now = new Date(LATEST_MS + SOAK * DAY);
    expect(retireRefusals(facts({ now }))).toEqual([]);
  });

  it("measures the soak from the latest activation across environments, not the earliest", () => {
    const later = "2026-11-10T00:00:00.000Z";
    const environments = [
      soaked("local"),
      { ...soaked("vps"), activated: later },
    ];
    const now = new Date(LATEST_MS + SOAK * DAY);
    expect(retireRefusals(facts({ environments, now }))).toEqual([
      "the soak after 2026-11-10T00:00:00.000Z ends 2026-11-24T00:00:00.000Z and has not elapsed",
    ]);
  });

  it("refuses a flag reverted since its latest activation, naming the revert", () => {
    const reverts = ["2026-11-05T12:00:00.000Z"];
    expect(retireRefusals(facts({ reverts }))).toEqual([
      "a revert was recorded at 2026-11-05T12:00:00.000Z, inside the soak after 2026-11-01T00:00:00.000Z",
    ]);
  });

  it("ignores a revert recorded before the latest activation, which the soak does not cover", () => {
    expect(
      retireRefusals(facts({ reverts: ["2026-10-01T00:00:00.000Z"] })),
    ).toEqual([]);
  });

  it("reads the soak length it is given, so a longer soak refuses a flag a shorter one accepts", () => {
    const now = new Date(LATEST_MS + 7 * DAY);
    expect(retireRefusals(facts({ now, soakDays: 7 }))).toEqual([]);
    expect(retireRefusals(facts({ now, soakDays: 30 }))).toHaveLength(1);
  });

  it("does not require an environment the entry marks not applicable", () => {
    const entry = { ...ENTRY, notApplicable: ["vps"] };
    expect(
      retireRefusals(facts({ entry, environments: [soaked("local")] })),
    ).toEqual([]);
  });

  it("reports every refusal together rather than the first", () => {
    const environments = [
      { ...soaked("local"), on: false },
      { ...soaked("vps"), proven: false },
    ];
    expect(retireRefusals(facts({ environments }))).toEqual([
      `${FLAG} is off in local`,
      `${FLAG} has no recorded outcome in vps`,
    ]);
  });

  it("refuses a flag that applies to no environment, since nothing shows it has soaked", () => {
    const entry = { ...ENTRY, applies: ["vps"], notApplicable: ["vps"] };
    expect(retireRefusals(facts({ entry, environments: [] }))).toEqual([
      `${FLAG} applies to no environment, so nothing shows it has soaked`,
    ]);
  });
});

describe("retirementEnvironments", () => {
  it("lists the environments the flag applies to, minus the ones it is not applicable to", () => {
    expect(
      retirementEnvironments({
        ...ENTRY,
        applies: ["local", "vps", "managed-example"],
        notApplicable: ["managed-example"],
      }),
    ).toEqual(["local", "vps"]);
  });
});
