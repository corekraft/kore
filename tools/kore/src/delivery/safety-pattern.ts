import { SAFETY_PATTERNS, isSafetyPattern } from "./flags-manifest.js";
import { MIGRATIONS_PATH } from "./migration-paths.js";

// Docs: AGENTS.md (Safety); the pattern is a git trailer on the head commit.
const TRAILER = /^Safety-pattern:[ \t]*(\S+)[ \t]*$/im;
const TEST_OR_DOC = [
  /(^|\/)(tests?|__tests__)\//,
  /\.(spec|test)\.[cm]?[jt]sx?$/,
  /\.md$/i,
  /^docs\//,
];

export interface PatternInput {
  pattern: string | undefined;
  changedPaths: string[];
  newFlags: string[];
}

/** The value of the Safety-pattern trailer in a commit message, or undefined when there is none. */
export function safetyTrailer(message: string): string | undefined {
  return TRAILER.exec(message)?.[1];
}

/**
 * Checks the declared pattern against the diff by rule: a migration forces expand-contract,
 * a new flag forces feature-flagged, and only tests and docs may claim no-behaviour-change.
 */
export function patternFailures(input: PatternInput): string[] {
  const { pattern, changedPaths, newFlags } = input;
  if (pattern === undefined) {
    return [
      `the head commit has no Safety-pattern trailer; add one of ${SAFETY_PATTERNS.join(", ")}`,
    ];
  }
  if (!isSafetyPattern(pattern)) {
    return [
      `Safety-pattern must be one of ${SAFETY_PATTERNS.join(", ")}; got "${pattern}"`,
    ];
  }
  const failures: string[] = [];
  if (
    changedPaths.some((path) => path.startsWith(MIGRATIONS_PATH)) &&
    pattern !== "expand-contract"
  ) {
    failures.push(
      `a migration under ${MIGRATIONS_PATH} needs the safety pattern expand-contract, not ${pattern}`,
    );
  }
  if (newFlags.length > 0 && pattern !== "feature-flagged") {
    failures.push(
      `a new flag (${newFlags.join(", ")}) needs the safety pattern feature-flagged, not ${pattern}`,
    );
  }
  if (pattern === "no-behaviour-change") {
    const others = changedPaths.filter((path) => !isTestOrDoc(path));
    if (others.length > 0) {
      failures.push(
        `no-behaviour-change allows only tests and docs; these changed files are not: ${others.join(", ")}`,
      );
    }
  }
  return failures;
}

function isTestOrDoc(path: string): boolean {
  return TEST_OR_DOC.some((pattern) => pattern.test(path));
}
