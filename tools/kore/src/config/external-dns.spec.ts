// Docs: docs/decisions/0162-external-dns-publishes-route-records-for-the-external-gateway-behind-external-dns.md
import { expect, test } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import { externalDnsErrors, externalDnsHelmArgs } from "./external-dns.js";
import type { Environment } from "./types.js";

// The domain, zone and address below are documentation values (example.com, RFC 5737), never real ones.
const exampleIPv4 = "203.0.113.10";
const exampleZone = "example-zone-id";

const local = fakeEnvironment({
  name: "local",
  provider: "k3d",
  platform: { domain: "kore.internal", organizationId: "platform" },
  features: { "external-dns": true },
});

const managed = fakeEnvironment({
  name: "vps",
  provider: "managed",
  platform: { domain: "kore.internal", organizationId: "platform" },
  features: { "external-dns": true },
});

const runTime = {
  KORE_PLATFORM_DOMAIN: "example.com",
  KORE_PUBLIC_IPV4: exampleIPv4,
  KORE_CLOUDFLARE_ZONE_ID: exampleZone,
};

function flagged(environment: Environment, on: boolean): Environment {
  return { ...environment, features: { "external-dns": on } };
}

test("with the external-dns flag off, the component takes no arguments and needs no run-time value", () => {
  const off = flagged(managed, false);
  expect(externalDnsHelmArgs(off, "external-dns", {})).toEqual([]);
  expect(externalDnsErrors(off, "external-dns", {})).toEqual([]);
});

test("a component other than external-dns takes no external-dns arguments, even with the flag on", () => {
  expect(externalDnsHelmArgs(managed, "kore-platform-config", runTime)).toEqual(
    [],
  );
  expect(externalDnsErrors(managed, "kore-platform-config", {})).toEqual([]);
});

test("the inmemory provider in local filters to the platform domain and excludes internal names by configuration", () => {
  expect(externalDnsHelmArgs(local, "external-dns", {})).toEqual([
    "--set-string",
    "domainFilters[0]=kore.internal",
    "--set-string",
    "excludeDomains[0]=internal.kore.internal",
    "--set-string",
    "extraArgs.default-targets=127.0.0.1",
  ]);
});

test("the Cloudflare provider adds the one zone as a zone-id filter, the domain and the address from run-time values", () => {
  expect(externalDnsHelmArgs(managed, "external-dns", runTime)).toEqual([
    "--set-string",
    "domainFilters[0]=example.com",
    "--set-string",
    "excludeDomains[0]=internal.example.com",
    "--set-string",
    `extraArgs.default-targets=${exampleIPv4}`,
    "--set-string",
    `extraArgs.zone-id-filter=${exampleZone}`,
  ]);
});

test("the exclusion is internal.<domain>, so an internal name is excluded by the configured list, not by luck", () => {
  const args = externalDnsHelmArgs(managed, "external-dns", runTime);
  expect(args).toContain("excludeDomains[0]=internal.example.com");
  expect(args).not.toContain("domainFilters[0]=internal.example.com");
});

test("the Cloudflare provider on vps refuses while the placeholder domain is in force, naming the variable", () => {
  expect(
    externalDnsErrors(managed, "external-dns", {
      KORE_PUBLIC_IPV4: exampleIPv4,
      KORE_CLOUDFLARE_ZONE_ID: exampleZone,
    }),
  ).toEqual([
    "environment vps turns on external-dns, which needs the platform domain: the overlay holds the placeholder kore.internal; set KORE_PLATFORM_DOMAIN in the shell that runs kore to the platform domain, or turn external-dns off",
  ]);
});

test("the Cloudflare provider refuses a missing public IPv4 or zone id, naming each variable", () => {
  expect(
    externalDnsErrors(managed, "external-dns", {
      KORE_PLATFORM_DOMAIN: "example.com",
      KORE_CLOUDFLARE_ZONE_ID: exampleZone,
    }),
  ).toEqual([
    "environment vps turns on external-dns, which needs the run-time value KORE_PUBLIC_IPV4 (the host's public IPv4 address); set it in the shell that runs kore, or turn external-dns off",
  ]);
  expect(
    externalDnsErrors(managed, "external-dns", {
      KORE_PLATFORM_DOMAIN: "example.com",
      KORE_PUBLIC_IPV4: exampleIPv4,
    }),
  ).toEqual([
    "environment vps turns on external-dns, which needs the run-time value KORE_CLOUDFLARE_ZONE_ID (the Cloudflare zone id of the platform domain); set it in the shell that runs kore, or turn external-dns off",
  ]);
});

test("the inmemory provider in local needs no run-time value and no credential", () => {
  expect(externalDnsErrors(local, "external-dns", {})).toEqual([]);
});

test("with every run-time value set, the Cloudflare provider on vps has no errors", () => {
  expect(externalDnsErrors(managed, "external-dns", runTime)).toEqual([]);
});
