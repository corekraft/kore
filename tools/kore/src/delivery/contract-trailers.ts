// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md
// A contract release names its kind, the release it was last used in and its soak window in git
// trailers on the head commit, beside Safety-pattern. A trailer needs no new file and no new input,
// and a data contract's flags manifest must stay unchanged, so the declaration cannot live there.
import { VERSION } from "./candidate.js";

export const CONTRACT_KINDS = ["data", "code"] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

export interface ContractDeclaration {
  kind: ContractKind;
  lastUsed: string;
  soakHours: number;
}

export interface ContractInput {
  message: string;
  version: string;
  pattern: string | undefined;
}

export interface ContractResult {
  declaration?: ContractDeclaration;
  failures: string[];
}

const ANY_CONTRACT = /^Contract-/im;
const RELEASE = /^Contract-release:[ \t]*(\S+)[ \t]*$/im;
const LAST_USED = /^Contract-last-used:[ \t]*(\S+)[ \t]*$/im;
const SOAK = /^Contract-soak-hours:[ \t]*(\S+)[ \t]*$/im;
// A whole number or a decimal, with no sign or exponent, so the only soak windows are positive.
const SOAK_HOURS = /^\d+(\.\d+)?$/;

/**
 * Reads the contract trailers of the head commit and checks their shape. A commit with no Contract
 * trailer declares no contract and raises nothing. The eval checks the shape only; the platform
 * checks the soak at run time, and nothing here resolves the named release in git.
 */
export function contractDeclaration(input: ContractInput): ContractResult {
  if (!ANY_CONTRACT.test(input.message)) {
    return { failures: [] };
  }
  const release = RELEASE.exec(input.message)?.[1];
  const lastUsed = LAST_USED.exec(input.message)?.[1];
  const soak = SOAK.exec(input.message)?.[1];
  const failures = [
    ...releaseFailures(release),
    ...lastUsedFailures(lastUsed, input.version),
    ...soakFailures(soak),
    ...patternFailure(input.pattern),
  ];
  if (
    failures.length > 0 ||
    release === undefined ||
    lastUsed === undefined ||
    soak === undefined
  ) {
    return { failures };
  }
  return {
    declaration: {
      kind: release as ContractKind,
      lastUsed,
      soakHours: Number(soak),
    },
    failures,
  };
}

function releaseFailures(release: string | undefined): string[] {
  if (release === undefined) {
    return [
      "Contract-release: data or code is missing; a contract names its kind, the release it was last used in and its soak window",
    ];
  }
  return (CONTRACT_KINDS as readonly string[]).includes(release)
    ? []
    : [`Contract-release must be data or code; got "${release}"`];
}

function lastUsedFailures(
  lastUsed: string | undefined,
  version: string,
): string[] {
  if (lastUsed === undefined) {
    return [
      "Contract-last-used: <version>+<sha> is missing; a contract names the earlier release in which the thing was last used",
    ];
  }
  if (!VERSION.test(lastUsed)) {
    return [
      `Contract-last-used must be a semantic version plus a commit SHA, such as 1.2.2+def5678; got "${lastUsed}"`,
    ];
  }
  return lastUsed === version
    ? [
        `Contract-last-used must name an earlier release; ${version} is this candidate's own version`,
      ]
    : [];
}

function soakFailures(soak: string | undefined): string[] {
  if (soak === undefined) {
    return [
      "Contract-soak-hours is missing; a contract states its soak window as a positive number of hours, such as 24",
    ];
  }
  const valid = SOAK_HOURS.test(soak) && Number(soak) > 0;
  return valid
    ? []
    : [
        `Contract-soak-hours must be a positive number of hours, such as 24; got "${soak}"`,
      ];
}

function patternFailure(pattern: string | undefined): string[] {
  return pattern === "expand-contract"
    ? []
    : [
        `a contract declares Safety-pattern expand-contract, not ${pattern ?? "none"}`,
      ];
}
