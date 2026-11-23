// Docs: docs/decisions/0097-an-outcome-issue-closes-on-recorded-proof-not-on-merge.md (versions are never reused)
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?\+[0-9a-f]{7,40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface CandidateInput {
  version: string;
  digest: string;
  /** Versions already published, with the digest each one was published for. */
  published?: Record<string, string> | undefined;
}

export interface CandidateResult {
  failures: string[];
  warnings: string[];
}

/**
 * Checks the candidate's identity: its version is semver plus a commit SHA, its digest is a
 * sha256, and a published version is never reused for a different digest. A rerun for the
 * same digest is accepted. Without a published list the reuse check cannot run, so it warns.
 */
export function checkCandidate(input: CandidateInput): CandidateResult {
  const failures: string[] = [];
  if (!VERSION.test(input.version)) {
    failures.push(
      "version must be a semantic version plus a commit SHA, such as 1.2.3+abc1234",
    );
  }
  if (!DIGEST.test(input.digest)) {
    failures.push("digest must be sha256: followed by 64 lowercase hex digits");
  }
  if (input.published === undefined) {
    return {
      failures,
      warnings: ["version reuse not checked: no --published file was given"],
    };
  }
  const existing = input.published[input.version];
  if (existing !== undefined && existing !== input.digest) {
    failures.push(
      `version ${input.version} is already published for ${existing}; a new build needs a new version`,
    );
  }
  return { failures, warnings: [] };
}
