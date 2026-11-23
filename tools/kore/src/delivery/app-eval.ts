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
}

export interface EvalAttestations {
  "eval-result": Statement;
  "flags-manifest": Statement;
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
  const pattern = safetyTrailer(await source.headMessage());
  const newFlags = await newFlagNames(source, flags.manifest);
  const failures = [
    ...candidate.failures,
    ...flags.failures,
    ...patternFailures({
      pattern,
      changedPaths: await source.changedPaths(),
      newFlags,
    }),
  ];
  const warnings = [
    ...candidate.warnings,
    ...(flags.manifest === undefined
      ? []
      : expiryWarnings(flags.manifest.flags, input.today)),
  ];
  const base = {
    version: input.version,
    digest: input.digest,
    failures,
    warnings,
  };
  const { manifest } = flags;
  if (failures.length > 0 || manifest === undefined || pattern === undefined) {
    return { verdict: "fail", ...base };
  }
  return {
    verdict: "pass",
    ...base,
    attestations: attestationsFor({
      version: input.version,
      digest: input.digest,
      manifest,
      pattern,
      warnings,
      expired: expiredFlags(manifest.flags, input.today),
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

/**
 * The flags this release adds. With no base manifest every flag is new, which conservatively
 * forces feature-flagged; with an unreadable base manifest the same applies.
 */
async function newFlagNames(
  source: AppSource,
  manifest: FlagsManifest | undefined,
): Promise<string[]> {
  if (manifest === undefined) {
    return [];
  }
  const baseText = await source.baseFlagsText();
  const known = new Set(
    baseText === undefined
      ? []
      : (parseFlagsManifest(baseText).manifest?.flags ?? []).map(
          (flag) => flag.name,
        ),
  );
  return manifest.flags
    .map((flag) => flag.name)
    .filter((name) => !known.has(name));
}

interface AttestInput {
  version: string;
  digest: string;
  manifest: FlagsManifest;
  pattern: string;
  warnings: string[];
  expired: string[];
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
  };
}
