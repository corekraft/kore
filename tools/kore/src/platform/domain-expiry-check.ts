// Docs: docs/decisions/0163-one-cloudflare-zone-holds-the-platform-domain-opentofu-owns-fixed-records-and-external-dns-owns-route-records.md
import {
  platformDomainVariable,
  runTimeDomain,
  type Environment,
} from "../config/index.js";
import {
  DomainExpiryError,
  expiryNotice,
  expiryWindowDays,
  parseRdapExpiry,
} from "./domain-expiry.js";

/**
 * What the check says. It never carries the domain value: the notice and the
 * unknown cause name only the number of days, the variable or the parser's cause.
 * `unknown` fails closed, so it is never read as ok.
 */
export type DomainExpiryResult =
  | { status: "ok"; daysLeft: number }
  | { status: "notify"; daysLeft: number; message: string }
  | { status: "unknown"; cause: string };

export interface DomainExpiryInput {
  environment: Environment;
  /** The environment the run-time domain is read from (ADR 0164). */
  env: NodeJS.ProcessEnv;
  /** The RDAP transport: given the domain, returns the response text. Injected, so no network call is made here. */
  read: (domain: string) => Promise<string>;
  now: Date;
}

/**
 * Reads the platform domain's expiry and says whether it is inside the notify
 * window. Notify-only: it never blocks or changes anything. A missing run-time
 * domain or a response that cannot give an expiry is `unknown`, naming the cause.
 * Any other failure of the reader is rethrown.
 */
export async function checkDomainExpiry(
  input: DomainExpiryInput,
): Promise<DomainExpiryResult> {
  const domain = runTimeDomain(input.environment, input.env);
  if (domain === undefined) {
    return {
      status: "unknown",
      cause: `${platformDomainVariable} is not set for this environment; set it to the platform domain in the shell that runs the check, then retry`,
    };
  }
  let expiresAt: Date;
  try {
    expiresAt = parseRdapExpiry(await input.read(domain));
  } catch (error) {
    if (error instanceof DomainExpiryError) {
      return { status: "unknown", cause: error.message };
    }
    throw error;
  }
  const notice = expiryNotice(expiresAt, input.now);
  if (!notice.notify) {
    return { status: "ok", daysLeft: notice.daysLeft };
  }
  return {
    status: "notify",
    daysLeft: notice.daysLeft,
    message: `the platform domain's registration expires in ${notice.daysLeft} days (under ${expiryWindowDays}); renew it at the registrar before it lapses`,
  };
}
