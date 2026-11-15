import assert from "node:assert/strict";
import { test } from "vitest";
import { sessionCookieViolations } from "./template-cookie.js";

// Pure text in, violations out: nothing here is mocked, because the function
// depends on nothing but its argument (ADR 0098).

const compliant = `server:
  port: 8080
  servlet:
    session:
      cookie:
        http-only: true
        secure: true
        same-site: lax
`;

test("a host-only HttpOnly, Secure, SameSite=lax session cookie has no violations", () => {
  assert.deepEqual(sessionCookieViolations(compliant), []);
});

test("SameSite=strict is accepted as well as lax", () => {
  const strict = compliant.replace("same-site: lax", "same-site: strict");
  assert.deepEqual(sessionCookieViolations(strict), []);
});

test("a session cookie that is not HttpOnly is reported", () => {
  const notHttpOnly = compliant.replace("http-only: true", "http-only: false");
  assert.deepEqual(sessionCookieViolations(notHttpOnly), [
    "HttpOnly is not set to true",
  ]);
});

test("a session cookie that is not Secure is reported", () => {
  const notSecure = compliant.replace("secure: true", "secure: false");
  assert.deepEqual(sessionCookieViolations(notSecure), [
    "Secure is not set to true",
  ]);
});

test("a session cookie with no SameSite, or SameSite none, is reported", () => {
  const missing = compliant.replace("        same-site: lax\n", "");
  const none = compliant.replace("same-site: lax", "same-site: none");
  for (const text of [missing, none]) {
    assert.deepEqual(sessionCookieViolations(text), [
      "SameSite is not lax or strict",
    ]);
  }
});

test("a Domain on the session cookie is reported, as a property or as a Domain attribute", () => {
  const property = compliant.replace(
    "        same-site: lax\n",
    "        same-site: lax\n        domain: corekraft.ca\n",
  );
  const attribute = `${compliant}# Set-Cookie: SESSION=x; Domain=corekraft.ca\n`;
  for (const text of [property, attribute]) {
    assert.deepEqual(sessionCookieViolations(text), [
      "a Domain is set; the cookie must be host-only",
    ]);
  }
});

test("a template that declares no session cookie reports every missing attribute", () => {
  assert.deepEqual(sessionCookieViolations("server:\n  port: 8080\n"), [
    "HttpOnly is not set to true",
    "Secure is not set to true",
    "SameSite is not lax or strict",
  ]);
});

test("an attribute set outside the session cookie block does not satisfy it", () => {
  const elsewhere = `management:
  http-only: true
  secure: true
  same-site: lax
`;
  assert.deepEqual(sessionCookieViolations(elsewhere), [
    "HttpOnly is not set to true",
    "Secure is not set to true",
    "SameSite is not lax or strict",
  ]);
});
