// Docs: docs/decisions/0169-an-app-declares-its-flags-and-the-platform-holds-their-state.md
import { PREDICATE_TYPES, statement, type Statement } from "./attestation.js";
import type { AppSource } from "./app-source.js";
import { checkCandidate } from "./candidate.js";
import { expiredFlags, expiryWarnings } from "./flag-expiry.js";
import {
  parseFlagsManifest,
  type FlagsManifest,
  type ParsedManifest,
} from "./flags-manifest.js";
import {
  migrationCarrier,
  type CarrierInput,
  type CarrierResult,
} from "./migration-carrier.js";
import { patternFailures, safetyTrailer } from "./safety-pattern.js";

const CHECKS = [
  "flags-manifest",
  "safety-pattern",
  "version-reuse",
  "flag-expiry",
];

export interface EvalInput {
  version: string;
  digest: string;
  published?: Record<string, string> | undefined;
  today: string;
  /** True only for the image that carries the migration plan (--carries-plan). */
  carriesPlan?: boolean | undefined;
  /** The N-1 inputs; the carrier needs them when the release adds a migration. */
  n1?: CarrierInput["n1"];
}

export interface EvalAttestations {
  "eval-result": Statement;
  "flags-manifest": Statement;
  "migration-plan": Statement;
}

export interface EvalReport {
  verdict: "pass" | "fail";
  version: string;
  digest: string;
  failures: string[];
  warnings: string[];
  /** Present only on a pass: a failing eval yields no payload to sign. */
  attestations?: EvalAttestations;
}

/**
 * Runs the deterministic checks on one candidate and reports every failure. An expired flag
 * only warns, so a pass with a warning still signs.
 */
export async function evaluateApp(
  source: AppSource,
  input: EvalInput,
): Promise<EvalReport> {
  const candidate = checkCandidate({
    version: input.version,
    digest: input.digest,
    published: input.published,
  });
  const flags = await readManifest(source);
  const message = await source.headMessage();
  const pattern = safetyTrailer(message);
  const base = await baseManifest(source);
  const newFlags = newFlagNames(flags.manifest, base);
  const changedPaths = await source.changedPaths();
  const migrations = await migrationCarrier({
    carries: input.carriesPlan === true,
    source,
    message,
    version: input.version,
    pattern,
    changedPaths,
    newFlags,
    retiredFlags: retiredFlagNames(base, flags.manifest),
    n1: input.n1,
  });
  const failures = [
    ...candidate.failures,
    ...flags.failures,
    ...patternFailures({ pattern, changedPaths, newFlags }),
    ...migrations.failures,
  ];
  const warnings = [
    ...candidate.warnings,
    ...(flags.manifest === undefined
      ? []
      : expiryWarnings(flags.manifest.flags, input.today)),
  ];
  const shared = {
    version: input.version,
    digest: input.digest,
    failures,
    warnings,
  };
  const { manifest } = flags;
  if (failures.length > 0 || manifest === undefined || pattern === undefined) {
    return { verdict: "fail", ...shared };
  }
  return {
    verdict: "pass",
    ...shared,
    attestations: attestationsFor({
      version: input.version,
      digest: input.digest,
      manifest,
      pattern,
      warnings,
      expired: expiredFlags(manifest.flags, input.today),
      plan: migrations.plan,
    }),
  };
}

async function readManifest(source: AppSource): Promise<ParsedManifest> {
  const text = await source.flagsText();
  if (text === undefined) {
    return {
      failures: [
        "flags.yaml is missing at the app root; declare the service and its flags, an empty list when it has none",
      ],
    };
  }
  return parseFlagsManifest(text);
}

/** The base commit's manifest, or undefined when the base has none or it does not parse. */
async function baseManifest(
  source: AppSource,
): Promise<FlagsManifest | undefined> {
  const text = await source.baseFlagsText();
  return text === undefined ? undefined : parseFlagsManifest(text).manifest;
}

/**
 * The flags this release adds. With no base manifest every flag is new, which conservatively
 * forces feature-flagged; with an unreadable base manifest the same applies.
 */
function newFlagNames(
  manifest: FlagsManifest | undefined,
  base: FlagsManifest | undefined,
): string[] {
  if (manifest === undefined) {
    return [];
  }
  const known = new Set((base?.flags ?? []).map((flag) => flag.name));
  return manifest.flags
    .map((flag) => flag.name)
    .filter((name) => !known.has(name));
}

/** The flags the base manifest declares and the head does not: what a code contract retires. */
function retiredFlagNames(
  base: FlagsManifest | undefined,
  head: FlagsManifest | undefined,
): string[] {
  if (base === undefined || head === undefined) {
    return [];
  }
  const kept = new Set(head.flags.map((flag) => flag.name));
  return base.flags.map((flag) => flag.name).filter((name) => !kept.has(name));
}

interface AttestInput {
  version: string;
  digest: string;
  manifest: FlagsManifest;
  pattern: string;
  warnings: string[];
  expired: string[];
  plan: CarrierResult["plan"];
}

function attestationsFor(input: AttestInput): EvalAttestations {
  const subject = { version: input.version, digest: input.digest };
  return {
    "eval-result": statement({
      predicateType: PREDICATE_TYPES.evalResult,
      ...subject,
      predicate: {
        verdict: "pass",
        version: input.version,
        safetyPattern: input.pattern,
        checks: CHECKS,
        warnings: input.warnings,
        expiredFlags: input.expired,
      },
    }),
    "flags-manifest": statement({
      predicateType: PREDICATE_TYPES.flagsManifest,
      ...subject,
      predicate: input.manifest,
    }),
    "migration-plan": statement({
      predicateType: PREDICATE_TYPES.migrationPlan,
      ...subject,
      predicate: input.plan,
    }),
  };
}
