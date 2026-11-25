import type { ManifestEntry } from "./manifest.js";
import type { Proof } from "./proof.js";

// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md

/** What proves a flag in an environment: its live run, its owner waiver, or nothing. */
export type ProofState = Proof["source"] | "none";

/** One applicable flag in the progress report, with its on state, its proof and what it waits on. */
export interface FlagRow {
  flag: string;
  kind: "feature" | "environment";
  on: boolean;
  proof: ProofState;
  waitsOn: string[];
}

/** A flag the report leaves out of what applies, and why. */
export interface ExcludedFlag {
  flag: string;
  status: "not applicable" | "pending" | "harness";
  reason: string;
}

/** The progress report for one environment, the same data the text and --json print (ADR 0148). */
export interface ProgressReport {
  environment: string;
  path: string;
  production: boolean;
  environmentFlags: FlagRow[];
  features: FlagRow[];
  excluded: ExcludedFlag[];
  everyApplicableFlagOn: boolean;
  next: { flag: string; kind: "feature" | "environment" } | null;
}

/** What the report reads: the manifest, the overlay's features and production mark, and each flag's recorded proof. */
export interface ProgressInput {
  environment: string;
  path: string;
  production: boolean;
  manifest: readonly ManifestEntry[];
  features: Readonly<Record<string, boolean>>;
  proofs: ReadonlyMap<string, Proof>;
}

const PENDING_REASON = "its naming decision has not landed (ADR 0148)";
const HARNESS_REASON = "only the local harness reads a harness flag (ADR 0148)";

/** Sorts one manifest entry into an applicable row or an excluded flag; undefined when it does not apply here. */
function classify(
  entry: ManifestEntry,
  environment: string,
): { row: "feature" | "environment" } | ExcludedFlag | undefined {
  if (!entry.applies.includes(environment)) {
    return undefined;
  }
  if (entry.notApplicable.includes(environment)) {
    return {
      flag: entry.name,
      status: "not applicable",
      reason: entry.reason ?? "",
    };
  }
  if (entry.pending) {
    return { flag: entry.name, status: "pending", reason: PENDING_REASON };
  }
  if (entry.kind === "harness") {
    return { flag: entry.name, status: "harness", reason: HARNESS_REASON };
  }
  return { row: entry.kind };
}

/**
 * The progress report for one environment (ADR 0148). A flag is applicable
 * when its manifest entry applies to the environment and no mark leaves it
 * out. Environment flags are reported apart from feature flags and never count
 * toward "every applicable feature flag is on". The next flag to prove is the
 * first flag, environment flags first, that has no live run and whose
 * requirements are all on; a flag still waiting on an off requirement is
 * passed over (ADR 0147). The proofs are read as given, already filtered by the
 * production rule, so this function never reads the ideas itself.
 */
export function progressOf(input: ProgressInput): ProgressReport {
  const { environment, manifest, features, proofs } = input;
  const on = (flag: string) => features[flag] === true;
  const excluded: ExcludedFlag[] = [];
  const rows: FlagRow[] = [];
  for (const entry of manifest) {
    const found = classify(entry, environment);
    if (found === undefined) {
      continue;
    }
    if (!("row" in found)) {
      excluded.push(found);
      continue;
    }
    rows.push({
      flag: entry.name,
      kind: found.row,
      on: on(entry.name),
      proof: proofs.get(entry.name)?.source ?? "none",
      waitsOn: entry.requires.filter((required) => !on(required)),
    });
  }
  const environmentFlags = rows.filter((row) => row.kind === "environment");
  const featureRows = rows.filter((row) => row.kind === "feature");
  const next = [...environmentFlags, ...featureRows].find(
    (row) => row.proof !== "live-run" && row.waitsOn.length === 0,
  );
  return {
    environment,
    path: input.path,
    production: input.production,
    environmentFlags,
    features: featureRows,
    excluded,
    everyApplicableFlagOn:
      featureRows.length > 0 && featureRows.every((row) => row.on),
    next: next === undefined ? null : { flag: next.flag, kind: next.kind },
  };
}
