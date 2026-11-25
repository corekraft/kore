// Recorded-shape fixtures for the domain expiry check (#1622, ADR 0163).
// They are hand-written in the RFC 9083 shape of a domain response for the
// placeholder example.com. No RDAP server was called, and no real domain appears
// here: the real read waits for the owner buying the domain.

/** A domain response with a registration, an expiration and a last-changed event. */
export const exampleRdapResponse = JSON.stringify({
  objectClassName: "domain",
  ldhName: "example.com",
  events: [
    { eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" },
    { eventAction: "expiration", eventDate: "2027-08-13T04:00:00Z" },
    { eventAction: "last changed", eventDate: "2025-08-14T07:01:38Z" },
  ],
});

/** The same response with the expiration event removed. */
export const responseWithoutExpiration = JSON.stringify({
  objectClassName: "domain",
  ldhName: "example.com",
  events: [{ eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" }],
});

/** The same response with no events list at all. */
export const responseWithoutEvents = JSON.stringify({
  objectClassName: "domain",
  ldhName: "example.com",
});

/** The same response with an expiration date that is not RFC 3339. */
export const responseWithBadExpiration = JSON.stringify({
  objectClassName: "domain",
  ldhName: "example.com",
  events: [{ eventAction: "expiration", eventDate: "13 August 2027" }],
});

/** The same response with an expiration date that is not a string. */
export const responseWithNumericExpiration = JSON.stringify({
  objectClassName: "domain",
  ldhName: "example.com",
  events: [{ eventAction: "expiration", eventDate: 20270813 }],
});

/** The same response with two expiration events, which is ambiguous. */
export const responseWithTwoExpirations = JSON.stringify({
  objectClassName: "domain",
  ldhName: "example.com",
  events: [
    { eventAction: "expiration", eventDate: "2027-08-13T04:00:00Z" },
    { eventAction: "expiration", eventDate: "2028-08-13T04:00:00Z" },
  ],
});

/** A registry error page, which is not JSON at all. */
export const notJson = "<html><body>Not Found</body></html>";

/** A JSON value that is not an object: an array. */
export const notAnObject = "[]";
