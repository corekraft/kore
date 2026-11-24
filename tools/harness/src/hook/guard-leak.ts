// The platform-domain leak rule (ADR 0164): a write or a command that names the value of
// KORE_PLATFORM_DOMAIN on this machine. The repository never holds the real name, so the rule
// warns and names the fix; it never echoes the value. Audit mode first, per ADR 0080.
import type { Finding } from "./guard-verdict.js";
import { warn } from "./guard-verdict.js";

export const PLATFORM_DOMAIN_RULE = "platform-domain-leak";
export const PLATFORM_DOMAIN_VARIABLE = "KORE_PLATFORM_DOMAIN";

/** Names the repository already holds: the placeholder, the local alias and the reserved example domain. */
const REPOSITORY_NAMES = new Set([
  "kore.internal",
  "kore.local",
  "example.com",
]);

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The domain the run-time variable names on this machine, lower-cased; undefined when the variable
 * is unset or blank, or names a domain the repository already holds, so nothing there warns.
 */
export function platformDomainOf(env: Env): string | undefined {
  const value = (env[PLATFORM_DOMAIN_VARIABLE] ?? "").trim().toLowerCase();
  return value === "" || REPOSITORY_NAMES.has(value) ? undefined : value;
}

/** The domain as a pattern: a literal match, bounded so that a longer name does not count. */
const pattern = (domain: string): RegExp =>
  // nosemgrep: kore-dynamic-regexp -- the value is escaped, and it comes from the machine's own environment
  new RegExp(
    `(?<![a-z0-9-])${domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9-])`,
    "i",
  );

/**
 * A warning when the text names the platform domain. It names the fix, and never the value, so a
 * hook's output and the ledger carry no real name.
 */
export function domainLeak(text: string, domain: string | undefined): Finding {
  if (domain === undefined || !pattern(domain).test(text)) {
    return null;
  }
  return warn(
    PLATFORM_DOMAIN_RULE,
    "This text names the platform domain that KORE_PLATFORM_DOMAIN holds on this machine, which the public repository never holds. " +
      "Instead, write example.com in its place.",
  );
}
