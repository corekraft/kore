import type { FlagDeclaration } from "./flags-manifest.js";

/** Names of the flags whose expiry is before today, in the order declared. */
export function expiredFlags(
  flags: FlagDeclaration[],
  today: string,
): string[] {
  return flags
    .filter((flag) => isExpired(flag, today))
    .map((flag) => flag.name);
}

/**
 * One warning per expired flag. An expired flag only warns: it never fails a release
 * (ADR 0169), so this is reported beside the verdict and never decides it.
 */
export function expiryWarnings(
  flags: FlagDeclaration[],
  today: string,
): string[] {
  return flags
    .filter((flag) => isExpired(flag, today))
    .map(
      (flag) =>
        `flag ${flag.name} expired on ${flag.expiry}; retire it or extend its expiry`,
    );
}

// Both are YYYY-MM-DD, so a string comparison is a date comparison.
function isExpired(flag: FlagDeclaration, today: string): boolean {
  return flag.expiry < today;
}
