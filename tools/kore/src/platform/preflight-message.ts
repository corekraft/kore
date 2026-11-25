// Docs: docs/decisions/0147-vps-v1-is-every-applicable-flag-proven-live-one-per-run-from-release-locks.md

/** One prerequisite a `platform up` preflight found missing, with the step that fixes it. */
export interface MissingPrerequisite {
  /** The prerequisite as an operator names it, such as "release chart lock". */
  name: string;
  /** What is wrong, as one clause with no full stop. */
  problem: string;
  /** The step that fixes it, as one clause with no full stop. */
  fix: string;
}

/** A URL: its address is the API server's, as kubectl names it. */
const SCHEME_URL = /https?:\/\/\S+?(?=:\s|\s|$)/g;

/**
 * A bare address with an optional port: an IPv4 address, a bracketed IPv6
 * address, or a dotted host name, as a dial error such as "dial tcp
 * 100.64.0.7:6443" names it.
 */
const BARE_ADDRESS =
  /\[[0-9a-f:]+\](?::\d+)?|\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+:\d+\b/gi;

/**
 * The first line of a failure, with every address replaced: the address of a
 * tailnet host never reaches a message or a log. A URL's address is named as
 * the API server; any other address as just "the address".
 */
export function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const [first = ""] = text.split("\n");
  return first
    .replace(SCHEME_URL, "the API server")
    .replace(BARE_ADDRESS, "the address");
}

/**
 * The one message a refused preflight prints: every missing prerequisite with
 * its fix, and that the run stopped before it changed anything.
 */
export function renderMissing(
  environment: string,
  missing: readonly MissingPrerequisite[],
): string {
  const count =
    missing.length === 1
      ? "1 prerequisite is"
      : `${missing.length} prerequisites are`;
  const lines = missing.map(
    ({ name, problem, fix }) => `- ${name}: ${problem}. Fix: ${fix}`,
  );
  return [
    `kore platform up --environment ${environment} stopped before any change: ${count} missing.`,
    ...lines,
  ].join("\n");
}
