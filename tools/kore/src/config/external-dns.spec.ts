// Docs: docs/decisions/0162-external-dns-publishes-route-records-for-the-external-gateway-behind-external-dns.md
import { beforeEach, expect, test, vi } from "vitest";
import { externalDnsErrors, externalDnsHelmArgs } from "./external-dns.js";
import { featureEnabled } from "./features.js";
import { isLocalProvider } from "./provider.js";
import { runTimeDomain } from "./run-time-domain.js";
import { runTimeValue } from "./run-time.js";
import type { Environment } from "./types.js";

vi.mock("./features.js", () => ({
  featureEnabled: vi.fn(),
  externalDnsFlag: "external-dns",
}));
vi.mock("./provider.js", () => ({ isLocalProvider: vi.fn() }));
vi.mock("./run-time-domain.js", () => ({
  runTimeDomain: vi.fn(),
  platformDomainVariable: "KORE_PLATFORM_DOMAIN",
}));
vi.mock("./run-time.js", () => ({
  runTimeValue: vi.fn(),
  runTimeVariables: {
    publicIPv4: "KORE_PUBLIC_IPV4",
    cloudflareZoneId: "KORE_CLOUDFLARE_ZONE_ID",
    tailnetAddress: "KORE_TAILNET_ADDRESS",
  },
}));

// The domain, zone and address below are documentation values (the reserved .test domain, RFC 5737 address), never real ones.
const exampleDomain = "kore.test";
const exampleIPv4 = "203.0.113.10";
const exampleZone = "example-zone-id";

const local: Environment = {
  name: "local",
  provider: "k3d",
  kubeContext: "k3d-kore-local",
  registry: { address: "10.96.0.50:5000" },
  platform: { domain: "kore.internal", organizationId: "platform" },
  secrets: {
    storeName: "platform-secrets",
    sourceNamespace: "kore-secret-source",
  },
  telemetry: { otlpEndpoint: "http://otel-collector.observability.svc:4318" },
  features: { "external-dns": true },
};

const managed: Environment = {
  name: "vps",
  provider: "managed",
  kubeContext: "kore-vps",
  registry: { address: "10.43.0.50:5000" },
  platform: { domain: "kore.internal", organizationId: "platform" },
  secrets: { storeName: "platform-secrets", sourceNamespace: "external" },
  telemetry: { otlpEndpoint: "http://otel-collector.observability.svc:4318" },
  features: { "external-dns": true },
};

const runTime = {
  KORE_PLATFORM_DOMAIN: exampleDomain,
  KORE_PUBLIC_IPV4: exampleIPv4,
  KORE_CLOUDFLARE_ZONE_ID: exampleZone,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(isLocalProvider).mockImplementation(
    (environment) => environment.provider === "k3d",
  );
  // The run-time domain is read only on a managed environment, as the real reader does.
  vi.mocked(runTimeDomain).mockImplementation((environment, env) =>
    environment.provider === "managed"
      ? env.KORE_PLATFORM_DOMAIN || undefined
      : undefined,
  );
  vi.mocked(runTimeValue).mockImplementation(
    (name, env) => env[name] || undefined,
  );
});

test("with the external-dns flag off, the component takes no arguments and needs no run-time value", () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(externalDnsHelmArgs(managed, "external-dns", {})).toEqual([]);
  expect(externalDnsErrors(managed, "external-dns", {})).toEqual([]);
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
    `domainFilters[0]=${exampleDomain}`,
    "--set-string",
    `excludeDomains[0]=internal.${exampleDomain}`,
    "--set-string",
    `extraArgs.default-targets=${exampleIPv4}`,
    "--set-string",
    `extraArgs.zone-id-filter=${exampleZone}`,
  ]);
});

test("the Helm arguments never set pod annotations or a ServiceMonitor: the scrape is a values-file setting (external-dns.yaml)", () => {
  const args = [
    ...externalDnsHelmArgs(local, "external-dns", {}),
    ...externalDnsHelmArgs(managed, "external-dns", runTime),
  ].join(" ");
  expect(args).not.toContain("podAnnotations");
  expect(args).not.toContain("prometheus.io");
  expect(args).not.toMatch(/serviceMonitor/i);
});

test("the exclusion is internal.<domain>, so an internal name is excluded by the configured list, not by luck", () => {
  const args = externalDnsHelmArgs(managed, "external-dns", runTime);
  expect(args).toContain(`excludeDomains[0]=internal.${exampleDomain}`);
  expect(args).not.toContain(`domainFilters[0]=internal.${exampleDomain}`);
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
      KORE_PLATFORM_DOMAIN: exampleDomain,
      KORE_CLOUDFLARE_ZONE_ID: exampleZone,
    }),
  ).toEqual([
    "environment vps turns on external-dns, which needs the run-time value KORE_PUBLIC_IPV4 (the host's public IPv4 address); set it in the shell that runs kore, or turn external-dns off",
  ]);
  expect(
    externalDnsErrors(managed, "external-dns", {
      KORE_PLATFORM_DOMAIN: exampleDomain,
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
