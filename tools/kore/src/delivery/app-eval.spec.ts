import { beforeEach, expect, test, vi } from "vitest";
import { PREDICATE_TYPES, statement } from "./attestation.js";
import type { AppSource } from "./app-source.js";
import { evaluateApp } from "./app-eval.js";
import { checkCandidate } from "./candidate.js";
import { expiredFlags, expiryWarnings } from "./flag-expiry.js";
import {
  parseFlagsManifest,
  type FlagDeclaration,
  type FlagsManifest,
} from "./flags-manifest.js";
import { migrationCarrier } from "./migration-carrier.js";
import { patternFailures, safetyTrailer } from "./safety-pattern.js";

// The orchestration is the unit: every rule it calls is mocked, so these tests observe what it
// passes to each rule and how it assembles the verdict and the statements (ADR 0098).
vi.mock("./attestation.js");
vi.mock("./candidate.js");
vi.mock("./flag-expiry.js");
vi.mock("./flags-manifest.js");
vi.mock("./migration-carrier.js");
vi.mock("./safety-pattern.js");

const EMPTY_PLAN = {
  release: "none",
  migrationsPath: null,
  migrations: [],
  contract: null,
  n1: "not-applicable",
};

const digest = `sha256:${"d".repeat(64)}`;
const version = "1.2.3+abc1234";
const today = "2026-11-23";

const flag = (name: string): FlagDeclaration => ({
  name,
  default: false,
  owner: "checkout-team",
  safetyPattern: "feature-flagged",
  expiry: "2027-06-30",
  rollout: { kind: "flag", criteria: ["errors-low"], soakHours: 4 },
});

const HEAD_TEXT = "head flags.yaml";
const BASE_TEXT = "base flags.yaml";
const head: FlagsManifest = {
  service: "leads",
  flags: [flag("leads.kept"), flag("leads.new-checkout")],
};
const base: FlagsManifest = { service: "leads", flags: [flag("leads.kept")] };

const source: AppSource = {
  flagsText: async () => HEAD_TEXT,
  baseFlagsText: async () => BASE_TEXT,
  changedPaths: async () => ["src/app.ts", "flags.yaml"],
  // The carrier reads these; a non-carrier run never calls them, and the carrier is mocked here.
  changes: async () => [],
  headText: async () => "",
  headMessage: async () => "feat: add\n\nSafety-pattern: feature-flagged\n",
};

const input = { version, digest, published: {}, today };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(checkCandidate).mockReturnValue({ failures: [], warnings: [] });
  vi.mocked(parseFlagsManifest).mockImplementation((text) =>
    text === HEAD_TEXT
      ? { manifest: head, failures: [] }
      : { manifest: base, failures: [] },
  );
  vi.mocked(safetyTrailer).mockReturnValue("feature-flagged");
  vi.mocked(patternFailures).mockReturnValue([]);
  vi.mocked(expiredFlags).mockReturnValue([]);
  vi.mocked(expiryWarnings).mockReturnValue([]);
  vi.mocked(statement).mockImplementation((args) => ({
    _type: "stub",
    subject: [],
    predicateType: args.predicateType,
    predicate: args.predicate,
  }));
  vi.mocked(migrationCarrier).mockResolvedValue({
    failures: [],
    plan: EMPTY_PLAN as never,
  });
});

test("a candidate that passes every rule gets a pass verdict, with both statements built from the head manifest", async () => {
  const report = await evaluateApp(source, input);
  expect(report.verdict).toBe("pass");
  expect(report.failures).toEqual([]);
  expect(statement).toHaveBeenCalledWith({
    predicateType: PREDICATE_TYPES.flagsManifest,
    version,
    digest,
    predicate: head,
  });
  expect(statement).toHaveBeenCalledWith({
    predicateType: PREDICATE_TYPES.evalResult,
    version,
    digest,
    predicate: {
      verdict: "pass",
      version,
      safetyPattern: "feature-flagged",
      checks: [
        "flags-manifest",
        "safety-pattern",
        "version-reuse",
        "flag-expiry",
      ],
      warnings: [],
      expiredFlags: [],
    },
  });
});

test("the migration-plan statement carries the carrier's plan, and is attested beside the other two", async () => {
  const plan = {
    release: "expand",
    migrationsPath: "migrations/",
    migrations: [{ path: "migrations/0002-add-note.sql", class: "expand" }],
    contract: null,
    n1: "passed",
  };
  vi.mocked(migrationCarrier).mockResolvedValue({
    failures: [],
    plan: plan as never,
  });
  const report = await evaluateApp(source, { ...input, carriesPlan: true });
  expect(report.verdict).toBe("pass");
  expect(statement).toHaveBeenCalledWith({
    predicateType: PREDICATE_TYPES.migrationPlan,
    version,
    digest,
    predicate: plan,
  });
  expect(Object.keys(report.attestations ?? {})).toEqual([
    "eval-result",
    "flags-manifest",
    "migration-plan",
  ]);
});

test("the carrier is asked to run only for a carrier, with the head message, the pattern and the new and retired flags", async () => {
  await evaluateApp(source, input);
  expect(migrationCarrier).toHaveBeenCalledWith({
    carries: false,
    source,
    message: "feat: add\n\nSafety-pattern: feature-flagged\n",
    version,
    pattern: "feature-flagged",
    changedPaths: ["src/app.ts", "flags.yaml"],
    newFlags: ["leads.new-checkout"],
    retiredFlags: [],
    n1: undefined,
  });
});

test("a flag the base manifest declares and the head does not is retired, and is passed to the carrier", async () => {
  vi.mocked(parseFlagsManifest).mockImplementation((text) =>
    text === HEAD_TEXT
      ? { manifest: head, failures: [] }
      : {
          manifest: { ...base, flags: [...base.flags, flag("leads.old")] },
          failures: [],
        },
  );
  await evaluateApp(source, { ...input, carriesPlan: true });
  expect(migrationCarrier).toHaveBeenCalledWith(
    expect.objectContaining({ carries: true, retiredFlags: ["leads.old"] }),
  );
});

test("a failure from the migration carrier fails the verdict and yields no statement, and is reported after the earlier rules", async () => {
  vi.mocked(patternFailures).mockReturnValue(["pattern failure"]);
  vi.mocked(migrationCarrier).mockResolvedValue({
    failures: ["migration migrations/0004.sql was modified"],
    plan: EMPTY_PLAN as never,
  });
  const report = await evaluateApp(source, { ...input, carriesPlan: true });
  expect(report.verdict).toBe("fail");
  expect(report.failures).toEqual([
    "pattern failure",
    "migration migrations/0004.sql was modified",
  ]);
  expect(statement).not.toHaveBeenCalled();
  expect(report).not.toHaveProperty("attestations");
});

test("only the flags the head declares and the base does not are new, and they reach the pattern rule", async () => {
  await evaluateApp(source, input);
  expect(patternFailures).toHaveBeenCalledWith({
    pattern: "feature-flagged",
    changedPaths: ["src/app.ts", "flags.yaml"],
    newFlags: ["leads.new-checkout"],
  });
});

test("a base with no flags.yaml makes every head flag new", async () => {
  await evaluateApp({ ...source, baseFlagsText: async () => undefined }, input);
  expect(patternFailures).toHaveBeenCalledWith(
    expect.objectContaining({ newFlags: ["leads.kept", "leads.new-checkout"] }),
  );
});

test("a failure from the candidate rule fails the verdict and yields no statement", async () => {
  vi.mocked(checkCandidate).mockReturnValue({
    failures: [
      "version must be a semantic version plus a commit SHA, such as 1.2.3+abc1234",
    ],
    warnings: [],
  });
  const report = await evaluateApp(source, input);
  expect(report.verdict).toBe("fail");
  expect(report.failures).toEqual([
    "version must be a semantic version plus a commit SHA, such as 1.2.3+abc1234",
  ]);
  expect(statement).not.toHaveBeenCalled();
  expect(report).not.toHaveProperty("attestations");
});

test("a manifest the schema refuses fails the verdict, reports its failures, and yields no statement", async () => {
  vi.mocked(parseFlagsManifest).mockReturnValue({
    failures: ["flag leads.x: default must be false; every flag ships off"],
  });
  const report = await evaluateApp(source, input);
  expect(report.verdict).toBe("fail");
  expect(report.failures).toEqual([
    "flag leads.x: default must be false; every flag ships off",
  ]);
  expect(statement).not.toHaveBeenCalled();
});

test("a missing flags.yaml fails with the file to write and parses nothing", async () => {
  const report = await evaluateApp(
    {
      ...source,
      flagsText: async () => undefined,
      baseFlagsText: async () => undefined,
    },
    input,
  );
  expect(report.failures).toEqual([
    "flags.yaml is missing at the app root; declare the service and its flags, an empty list when it has none",
  ]);
  expect(parseFlagsManifest).not.toHaveBeenCalled();
  expect(statement).not.toHaveBeenCalled();
});

test("a head commit with no pattern fails the verdict even when the pattern rule raises nothing", async () => {
  vi.mocked(safetyTrailer).mockReturnValue(undefined);
  vi.mocked(patternFailures).mockReturnValue([]);
  const report = await evaluateApp(source, input);
  expect(report.verdict).toBe("fail");
  expect(statement).not.toHaveBeenCalled();
});

test("an expired flag's warning and the expired names reach the report and the eval result, and never fail it", async () => {
  vi.mocked(expiryWarnings).mockReturnValue([
    "flag leads.kept expired on 2026-01-15; retire it or extend its expiry",
  ]);
  vi.mocked(expiredFlags).mockReturnValue(["leads.kept"]);
  const report = await evaluateApp(source, input);
  expect(report.verdict).toBe("pass");
  expect(report.warnings).toEqual([
    "flag leads.kept expired on 2026-01-15; retire it or extend its expiry",
  ]);
  expect(expiryWarnings).toHaveBeenCalledWith(head.flags, today);
  expect(expiredFlags).toHaveBeenCalledWith(head.flags, today);
  expect(statement).toHaveBeenCalledWith(
    expect.objectContaining({
      predicate: expect.objectContaining({
        warnings: [
          "flag leads.kept expired on 2026-01-15; retire it or extend its expiry",
        ],
        expiredFlags: ["leads.kept"],
      }),
    }),
  );
});

test("a warning from the candidate rule reaches the report", async () => {
  vi.mocked(checkCandidate).mockReturnValue({
    failures: [],
    warnings: ["version reuse not checked: no --published file was given"],
  });
  const report = await evaluateApp(source, input);
  expect(report.verdict).toBe("pass");
  expect(report.warnings).toEqual([
    "version reuse not checked: no --published file was given",
  ]);
});

test("every failing rule is reported together, in rule order", async () => {
  vi.mocked(checkCandidate).mockReturnValue({
    failures: ["candidate failure"],
    warnings: [],
  });
  vi.mocked(parseFlagsManifest).mockReturnValue({
    failures: ["manifest failure"],
  });
  vi.mocked(patternFailures).mockReturnValue(["pattern failure"]);
  const report = await evaluateApp(source, input);
  expect(report.failures).toEqual([
    "candidate failure",
    "manifest failure",
    "pattern failure",
  ]);
});
