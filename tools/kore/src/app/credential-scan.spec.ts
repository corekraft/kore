import { expect, test } from "vitest";
import { exposesCredential } from "./credential-scan.js";

test("a resource kind or field name that merely contains a credential word is not a credential", () => {
  expect(
    exposesCredential(
      '{"resources":{"v1/AuthorizationPolicy":[{"kind":"AuthorizationPolicy"}]},"passwordSecretRef":{"name":"db"}}',
    ),
  ).toBe(false);
});

test("credential-shaped keys with values, bearer tokens and private keys are detected", () => {
  expect(exposesCredential('{"password":"hunter2"}')).toBe(true);
  expect(exposesCredential('{"Authorization":"Basic YWJj"}')).toBe(true);
  expect(exposesCredential('{"api_token":"abc"}')).toBe(true);
  expect(exposesCredential('"detail":"Bearer abc.def"')).toBe(true);
  expect(exposesCredential("-----BEGIN EC PRIVATE KEY-----")).toBe(true);
});
