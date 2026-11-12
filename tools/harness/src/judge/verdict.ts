import type { ChangedFile } from "./diff.js";
import type { Pattern } from "./declaration.js";
import { NOT_BEHAVIOUR, type Hints } from "./hints.js";

export interface Assessment {
  patternMatches: boolean;
  patternMismatch?: string;
  clusterFacing: boolean;
  /** What the precheck cannot establish; the judge or a live run must. */
  unverified: string[];
}

const CLUSTER = /^(apps|infra|catalog)\/|(^|\/)charts?\//;

/** Whether the diff touches what runs in a cluster: apps, infra, catalog or chart files. */
export function clusterFacing(files: readonly ChangedFile[]): boolean {
  return files.some((f) => CLUSTER.test(f.path) && !NOT_BEHAVIOUR.test(f.path));
}

const MISMATCH: Record<Pattern, (hints: Hints) => string | undefined> = {
  "no-behaviour-change": (h) =>
    h["noBehaviouralDiff"] === true
      ? undefined
      : `no-behaviour-change, but the diff changes behaviour in: ${(h["behaviouralPaths"] as string[]).join(", ")}`,
  "feature-flagged": (h) =>
    h["flagPresentAndOff"] === true
      ? undefined
      : "feature-flagged, but the diff adds no flag that is off in an environment overlay",
  "dark-launched": (h) =>
    h["flagOnlyInLocal"] === true
      ? undefined
      : "dark-launched, but the diff adds no flag that is on only in the local overlay",
  "branch-by-abstraction": (h) =>
    h["oldPathRetained"] === true
      ? undefined
      : `branch-by-abstraction, but the diff deletes the old path: ${(h["deletedFiles"] as string[]).join(", ")}`,
  "expand-contract": () => undefined,
};

const UNVERIFIED: Record<Pattern, string[]> = {
  "no-behaviour-change": ["behaviour equivalence not verified"],
  "feature-flagged": ["gating not verified"],
  "dark-launched": ["gating not verified"],
  "branch-by-abstraction": ["abstraction seam not verified"],
  "expand-contract": ["compatibility of both steps not verified"],
};

/** Compares the hints to the declared pattern, and lists what remains to be verified. */
export function assess(
  pattern: Pattern,
  hints: Hints,
  files: readonly ChangedFile[],
): Assessment {
  const mismatch = MISMATCH[pattern](hints);
  const cluster = clusterFacing(files);
  const live =
    pattern === "no-behaviour-change"
      ? "cluster-facing: live run required before merge"
      : "cluster-facing: live proof required before the flag turns on";
  return {
    patternMatches: mismatch === undefined,
    ...(mismatch === undefined ? {} : { patternMismatch: mismatch }),
    clusterFacing: cluster,
    unverified: [...UNVERIFIED[pattern], ...(cluster ? [live] : [])],
  };
}
