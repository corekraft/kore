// Docs: docs/decisions/0157-a-name-under-another-domain-is-served-after-an-http-01-proof-and-certificates-come-from-acme.md
import { beforeEach, expect, test, vi } from "vitest";
import {
  acmeCertificateIssuer,
  acmeIssuersErrors,
  externalGatewayAcmeIssuersErrors,
} from "./acme-issuers.js";
import { appliedFlags } from "./flag-manifest.js";
import { featureEnabled } from "./features.js";
import { runTimeDomain } from "./run-time-domain.js";
import type { Environment, FlagManifest } from "./types.js";

vi.mock("./features.js", () => ({
  featureEnabled: vi.fn(),
  acmeIssuersFlag: "acme-issuers",
  externalGatewayFlag: "external-gateway",
}));
vi.mock("./flag-manifest.js", () => ({ appliedFlags: vi.fn() }));
vi.mock("./run-time-domain.js", () => ({
  runTimeDomain: vi.fn(),
  platformDomainVariable: "KORE_PLATFORM_DOMAIN",
}));

// The domain below is the documentation value example.com, never a real one.
const exampleDomain = "example.com";

const managed: Environment = {
  name: "vps",
  provider: "managed",
  kubeContext: "kore-vps",
  registry: { address: "10.43.0.50:5000" },
  platform: { domain: "kore.internal", organizationId: "platform" },
  secrets: { storeName: "platform-secrets", sourceNamespace: "external" },
  telemetry: { otlpEndpoint: "http://otel-collector.observability.svc:4318" },
  features: { "acme-issuers": true },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(featureEnabled).mockReturnValue(true);
  // The run-time domain is read only on a managed environment, as the real reader does.
  vi.mocked(runTimeDomain).mockImplementation((environment, env) =>
    environment.provider === "managed"
      ? env.KORE_PLATFORM_DOMAIN || undefined
      : undefined,
  );
});

test("every ACME certificate names the staging issuer, whatever the flags are, until acme-production exists", () => {
  expect(acmeCertificateIssuer()).toBe("letsencrypt-staging");
  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(acmeCertificateIssuer()).toBe("letsencrypt-staging");
});

test("with the acme-issuers flag off, the placeholder domain is not refused", () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(acmeIssuersErrors(managed, {})).toEqual([]);
});

test("on the managed environment with the placeholder domain in force, the flag refuses naming the placeholder domain, the variable and the fix", () => {
  expect(acmeIssuersErrors(managed, {})).toEqual([
    "environment vps turns on acme-issuers, which needs the platform domain: the overlay holds the placeholder kore.internal; set KORE_PLATFORM_DOMAIN in the shell that runs kore to the platform domain, or turn acme-issuers off",
  ]);
});

test("with the run-time domain set, the flag has no error", () => {
  expect(
    acmeIssuersErrors(managed, { KORE_PLATFORM_DOMAIN: exampleDomain }),
  ).toEqual([]);
});

const flags: FlagManifest = { flags: [] };

/** The flags that are on, by name; every other flag is off in the overlay. */
function flagsOn(...on: string[]): void {
  vi.mocked(featureEnabled).mockImplementation((_environment, flag) =>
    on.includes(flag),
  );
}

/** Where acme-issuers applies: vps alone, as the manifest says; every other environment lists only external-gateway. */
function acmeIssuersAppliesOnlyToVps(): void {
  vi.mocked(appliedFlags).mockImplementation((_manifest, name) =>
    name === "vps"
      ? ["external-gateway", "acme-issuers"]
      : ["external-gateway"],
  );
}

test("with external-gateway on where acme-issuers applies and acme-issuers off, the check fails naming both flags and the fix", () => {
  flagsOn("external-gateway");
  acmeIssuersAppliesOnlyToVps();
  expect(externalGatewayAcmeIssuersErrors(managed, flags)).toEqual([
    'environment vps turns on external-gateway, which needs acme-issuers, but acme-issuers is off there; set "acme-issuers": true in the vps overlay, or turn external-gateway off (ADR 0157)',
  ]);
});

test("the check asks the manifest where acme-issuers applies, by the environment's name, and reads that list rather than a hardcoded environment", () => {
  flagsOn("external-gateway");
  acmeIssuersAppliesOnlyToVps();
  externalGatewayAcmeIssuersErrors(managed, flags);
  expect(vi.mocked(appliedFlags)).toHaveBeenCalledWith(flags, "vps");
});

test("with acme-issuers on, the check passes where external-gateway is on", () => {
  flagsOn("external-gateway", "acme-issuers");
  acmeIssuersAppliesOnlyToVps();
  expect(externalGatewayAcmeIssuersErrors(managed, flags)).toEqual([]);
});

test("with external-gateway off, the check passes whatever acme-issuers is", () => {
  flagsOn("acme-issuers");
  acmeIssuersAppliesOnlyToVps();
  expect(externalGatewayAcmeIssuersErrors(managed, flags)).toEqual([]);
});

test("where acme-issuers does not apply, as in local and managed-example, the check stays silent with external-gateway on", () => {
  flagsOn("external-gateway");
  acmeIssuersAppliesOnlyToVps();
  for (const name of ["local", "managed-example"]) {
    expect(
      externalGatewayAcmeIssuersErrors({ ...managed, name }, flags),
      name,
    ).toEqual([]);
  }
});
