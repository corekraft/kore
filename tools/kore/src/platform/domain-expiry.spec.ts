// Docs: docs/decisions/0163-one-cloudflare-zone-holds-the-platform-domain-opentofu-owns-fixed-records-and-external-dns-owns-route-records.md
import { expect, test } from "vitest";
import {
  DomainExpiryError,
  expiryNotice,
  expiryWindowDays,
  parseRdapExpiry,
} from "./domain-expiry.js";
import {
  exampleRdapResponse,
  notAnObject,
  notJson,
  responseWithBadExpiration,
  responseWithNumericExpiration,
  responseWithoutEvents,
  responseWithoutExpiration,
  responseWithTwoExpirations,
} from "./domain-expiry-fixtures.js";

const dayMs = 86_400_000;

test("the expiry date is the expiration event of a recorded RDAP response", () => {
  expect(parseRdapExpiry(exampleRdapResponse)).toEqual(
    new Date("2027-08-13T04:00:00Z"),
  );
});

test("a malformed response fails closed, naming the cause as not JSON", () => {
  expect(() => parseRdapExpiry(notJson)).toThrow(DomainExpiryError);
  expect(() => parseRdapExpiry(notJson)).toThrow(/not JSON/);
});

test("a response that is not a JSON object fails closed, naming the cause", () => {
  expect(() => parseRdapExpiry(notAnObject)).toThrow(/not a JSON object/);
});

test("a response with no events list fails closed, naming the cause", () => {
  expect(() => parseRdapExpiry(responseWithoutEvents)).toThrow(
    /no events list/,
  );
});

test("a missing expiration event fails closed, naming the cause", () => {
  expect(() => parseRdapExpiry(responseWithoutExpiration)).toThrow(
    /no expiration event/,
  );
});

test("two expiration events fail closed rather than picking one", () => {
  expect(() => parseRdapExpiry(responseWithTwoExpirations)).toThrow(
    /more than one expiration event/,
  );
});

test("an expiration date that is not RFC 3339 fails closed, naming the cause", () => {
  expect(() => parseRdapExpiry(responseWithBadExpiration)).toThrow(
    /not an RFC 3339 date-time/,
  );
});

test("an expiration date that is not a string fails closed, naming the cause", () => {
  expect(() => parseRdapExpiry(responseWithNumericExpiration)).toThrow(
    /eventDate is not a string/,
  );
});

test("a parse error never echoes the response, so no domain value leaks into it", () => {
  for (const text of [
    responseWithBadExpiration,
    responseWithoutExpiration,
    responseWithNumericExpiration,
  ]) {
    let message = "";
    try {
      parseRdapExpiry(text);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("example.com");
  }
});

test("the window is thirty days", () => {
  expect(expiryWindowDays).toBe(30);
});

test("a registration that expires in thirty days or more is not notified", () => {
  const now = new Date("2026-11-24T00:00:00Z");
  const expiresAt = new Date(now.getTime() + 30 * dayMs);
  expect(expiryNotice(expiresAt, now)).toEqual({ daysLeft: 30, notify: false });
});

test("a registration that expires in under thirty days is notified", () => {
  const now = new Date("2026-11-24T00:00:00Z");
  const expiresAt = new Date(now.getTime() + 30 * dayMs - 1);
  expect(expiryNotice(expiresAt, now).notify).toBe(true);
});

test("a registration that has already expired is notified with a negative day count", () => {
  const now = new Date("2026-11-24T00:00:00Z");
  const expiresAt = new Date(now.getTime() - 2 * dayMs);
  expect(expiryNotice(expiresAt, now)).toEqual({ daysLeft: -2, notify: true });
});
