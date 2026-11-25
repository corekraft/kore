import { isReleaseAutomationSigner } from "../images/index.js";

// Docs: docs/decisions/0147-vps-v1-is-every-applicable-flag-proven-live-one-per-run-from-release-locks.md

/** The signers a lock declares, or none when it declares no list. */
function declaredSigners(lock: unknown): unknown[] {
  if (
    typeof lock !== "object" ||
    lock === null ||
    !("authorizedSigners" in lock)
  ) {
    return [];
  }
  return Array.isArray(lock.authorizedSigners) ? lock.authorizedSigners : [];
}

/**
 * True for a release lock: a lock that declares signers, every one of which is
 * release automation at a version tag. A main chart lock (ADR 0138), a developer
 * key's lock, and a lock that names no signer are not. This reads the signers a
 * lock declares and verifies no signature; the chart-signature check still to
 * come will do that (ADR 0147).
 */
export function isReleaseLock(lock: unknown): boolean {
  const signers = declaredSigners(lock);
  return (
    signers.length > 0 &&
    signers.every(
      (signer) =>
        typeof signer === "string" && isReleaseAutomationSigner(signer),
    )
  );
}

/** The signers a lock declares, for a refusal to name; "no signer" when it declares none. */
export function describeSigners(lock: unknown): string {
  const signers = declaredSigners(lock);
  return signers.length === 0 ? "no signer" : signers.map(String).join(", ");
}
