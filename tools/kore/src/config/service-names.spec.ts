// Docs: docs/decisions/0159-services-attach-to-the-platform-gateways-through-listener-sets-and-hostname-claims.md
import { expect, test } from "vitest";
import { serviceNames } from "./service-names.js";

const service = {
  name: "leads",
  organization: "api",
  domain: "example.com",
  internalDomain: "example.com",
  hostnames: [] as readonly string[],
};

test("an internal service with no hostnames list gets only its internal name", () => {
  expect(serviceNames({ ...service, gateway: "internal" })).toEqual({
    internal: "leads.api.example.com",
    defaultPublic: undefined,
    publicNames: [],
    claimed: [],
  });
});

test("an external service with no hostnames list gets the default public name", () => {
  expect(serviceNames({ ...service, gateway: "external" })).toEqual({
    internal: "leads.api.example.com",
    defaultPublic: "leads.api.example.com",
    publicNames: ["leads.api.example.com"],
    claimed: [],
  });
});

test("a hostnames list replaces the default public name and never the internal name", () => {
  const names = serviceNames({
    ...service,
    gateway: "external",
    hostnames: ["leads.example.org", "login.example.com"],
  });
  expect(names.internal).toBe("leads.api.example.com");
  expect(names.defaultPublic).toBeUndefined();
  expect(names.publicNames).toEqual(["leads.example.org", "login.example.com"]);
});

test("with an internal domain of internal.<domain>, the internal name lives under it and the default public name under the domain", () => {
  const names = serviceNames({
    ...service,
    gateway: "external",
    internalDomain: "internal.example.com",
  });
  expect(names.internal).toBe("leads.api.internal.example.com");
  expect(names.defaultPublic).toBe("leads.api.example.com");
});

test("a claim is a hostname directly under the platform domain, and a name in the claimant's own zone needs none", () => {
  const names = serviceNames({
    ...service,
    gateway: "external",
    hostnames: ["login.example.com", "shop.api.example.com"],
  });
  expect(names.claimed).toEqual(["login.example.com"]);
});

test("an empty hostnames list counts as no list, so the default public name still applies", () => {
  expect(serviceNames({ ...service, gateway: "external" }).publicNames).toEqual(
    ["leads.api.example.com"],
  );
});
