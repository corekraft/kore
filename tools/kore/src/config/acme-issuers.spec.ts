// Docs: docs/decisions/0157-a-name-under-another-domain-is-served-after-an-http-01-proof-and-certificates-come-from-acme.md
import { beforeEach, expect, test, vi } from "vitest";
import { acmeCertificateIssuer, acmeIssuersErrors } from "./acme-issuers.js";
import { featureEnabled } from "./features.js";
import { runTimeDomain } from "./run-time-domain.js";
import type { Environment } from "./types.js";

vi.mock("./features.js", () => ({
  featureEnabled: vi.fn(),
  acmeIssuersFlag: "acme-issuers",
}));
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
