// Docs: docs/decisions/0163-one-cloudflare-zone-holds-the-platform-domain-opentofu-owns-fixed-records-and-external-dns-owns-route-records.md

/** The notify window: a registration expiring in under this many days is notified (#1622). */
export const expiryWindowDays = 30;

const dayMs = 86_400_000;

/** An RDAP response that cannot give an expiry, named by its cause and never by its text. */
export class DomainExpiryError extends Error {}

/** An RFC 3339 date-time with a zone designator, as RDAP's eventDate must be. */
const rfc3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** The fix every parse error names: the operator checks the response and records it on the ticket. */
const fixClause =
  "check the registrar's RDAP response against the parser, then record the result on #1622";

/** A refusal that names its cause and then the fix, so the operator knows what to do next. */
function refusal(cause: string): DomainExpiryError {
  return new DomainExpiryError(`${cause}; fix: ${fixClause}`);
}

/** A JSON object: not null and not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The expiry date from an RDAP domain response (RFC 9083). It reads the one
 * event whose eventAction is expiration. Any other shape fails closed with a
 * DomainExpiryError that names the cause; the response is never echoed back.
 */
export function parseRdapExpiry(text: string): Date {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw refusal(
      "the RDAP response is not JSON; the registry did not return a domain record",
    );
  }
  if (!isRecord(document)) {
    throw refusal(
      "the RDAP response is not a JSON object; the registry did not return a domain record",
    );
  }
  const events = document["events"];
  if (!Array.isArray(events)) {
    throw refusal(
      "the RDAP response has no events list; the registry does not publish events for this domain",
    );
  }
  const expirations = events.filter(
    (event): event is Record<string, unknown> =>
      isRecord(event) && event["eventAction"] === "expiration",
  );
  if (expirations.length === 0) {
    throw refusal(
      "the RDAP response has no expiration event; the registrar does not publish one",
    );
  }
  if (expirations.length > 1) {
    throw refusal(
      "the RDAP response has more than one expiration event, so the expiry is ambiguous",
    );
  }
  const eventDate = expirations[0]?.["eventDate"];
  if (typeof eventDate !== "string") {
    throw refusal("the expiration event's eventDate is not a string");
  }
  const parsed = Date.parse(eventDate);
  if (!rfc3339.test(eventDate) || Number.isNaN(parsed)) {
    throw refusal(
      "the expiration event's eventDate is not an RFC 3339 date-time",
    );
  }
  return new Date(parsed);
}

/** The days left until a registration expires, and whether the notify window has been reached. */
export interface ExpiryNotice {
  daysLeft: number;
  notify: boolean;
}

/**
 * Whether a registration expiring at `expiresAt` is inside the notify window at
 * `now`. An expiry already past is notified too, with a negative day count.
 */
export function expiryNotice(expiresAt: Date, now: Date): ExpiryNotice {
  const remaining = expiresAt.getTime() - now.getTime();
  return {
    daysLeft: Math.floor(remaining / dayMs),
    notify: remaining < expiryWindowDays * dayMs,
  };
}
