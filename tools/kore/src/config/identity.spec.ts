// Docs: docs/decisions/0007-workload-identity-and-layered-authorization.md
import { expect, test } from "vitest";
import { parsePrincipal, spiffeId, spiffePrincipal } from "./identity.js";

test("a SPIFFE ID is the scheme plus the principal, which names trust domain, namespace and account", () => {
  expect(spiffeId("cluster.local", "shop", "api")).toBe(
    "spiffe://cluster.local/ns/shop/sa/api",
  );
});

test("an AuthorizationPolicy principal is the SPIFFE ID without its scheme", () => {
  expect(spiffePrincipal("cluster.local", "shop", "api")).toBe(
    "cluster.local/ns/shop/sa/api",
  );
});

test("a principal with or without the spiffe scheme parses to the same parts", () => {
  const parts = {
    trustDomain: "cluster.local",
    namespace: "shop",
    serviceAccount: "api",
  };
  expect(parsePrincipal("spiffe://cluster.local/ns/shop/sa/api")).toEqual(
    parts,
  );
  expect(parsePrincipal("cluster.local/ns/shop/sa/api")).toEqual(parts);
});

test("a principal parses back from the values that built it", () => {
  const built = spiffePrincipal("kore.example", "kore-system", "gateway-1");
  expect(parsePrincipal(built)).toEqual({
    trustDomain: "kore.example",
    namespace: "kore-system",
    serviceAccount: "gateway-1",
  });
});

test("a wildcard or a malformed principal parses to nothing, never to partial parts", () => {
  expect(parsePrincipal("cluster.local/ns/*/sa/api")).toBeUndefined();
  expect(parsePrincipal("cluster.local/ns/shop/sa/*")).toBeUndefined();
  expect(parsePrincipal("cluster.local/ns/shop")).toBeUndefined();
  expect(
    parsePrincipal("spiffe://Cluster.Local/ns/shop/sa/api"),
  ).toBeUndefined();
  expect(parsePrincipal("")).toBeUndefined();
});

test("a namespace or account with an uppercase letter or a leading dash is not a principal", () => {
  expect(parsePrincipal("cluster.local/ns/Shop/sa/api")).toBeUndefined();
  expect(parsePrincipal("cluster.local/ns/-shop/sa/api")).toBeUndefined();
  expect(parsePrincipal("cluster.local/ns/shop/sa/-api")).toBeUndefined();
});
