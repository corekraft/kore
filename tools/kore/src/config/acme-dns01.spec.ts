// Docs: docs/decisions/0161-cert-manager-solves-dns-01-through-cloudflare-and-issues-per-suborg-wildcards-behind-acme-dns01.md
import { beforeEach, expect, test, vi } from "vitest";
import {
  acmeDns01Errors,
  acmeDns01HelmArgs,
  acmeResolverArgs,
} from "./acme-dns01.js";
import { featureEnabled } from "./features.js";
import { runTimeDomain } from "./run-time-domain.js";
import type { Environment } from "./types.js";

vi.mock("./features.js", () => ({
  featureEnabled: vi.fn(),
  acmeDns01Flag: "acme-dns01",
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
  features: { "acme-dns01": true },
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

test("the resolvers are pinned public addresses that contain no domain", () => {
  expect(acmeResolverArgs).toEqual([
    "--dns01-recursive-nameservers=1.1.1.1:53,8.8.8.8:53",
    "--dns01-recursive-nameservers-only",
  ]);
  expect(acmeResolverArgs.join(" ")).not.toContain(exampleDomain);
  expect(acmeResolverArgs.join(" ")).not.toContain("kore.internal");
});

test("with the acme-dns01 flag off, no component takes an argument and the placeholder domain is not refused", () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(acmeDns01HelmArgs(managed, "cert-manager", {})).toEqual([]);
  expect(acmeDns01HelmArgs(managed, "kore-local-tls", {})).toEqual([]);
  expect(acmeDns01Errors(managed, {})).toEqual([]);
});

test("with the flag on, cert-manager takes the pinned resolvers as its controller arguments, passed as JSON so the comma-separated list survives", () => {
  expect(
    acmeDns01HelmArgs(managed, "cert-manager", {
      KORE_PLATFORM_DOMAIN: exampleDomain,
    }),
  ).toEqual(["--set-json", `extraArgs=${JSON.stringify(acmeResolverArgs)}`]);
});

test("with the flag on, the platform certificate chart takes the one platform domain as its zone, so the issuers select that zone only", () => {
  expect(
    acmeDns01HelmArgs(managed, "kore-local-tls", {
      KORE_PLATFORM_DOMAIN: exampleDomain,
    }),
  ).toEqual(["--set-string", `acmeDns01.zone=${exampleDomain}`]);
});

test("a component other than cert-manager or the platform certificate takes no acme-dns01 argument, even with the flag on", () => {
  expect(
    acmeDns01HelmArgs(managed, "kore-platform-config", {
      KORE_PLATFORM_DOMAIN: exampleDomain,
    }),
  ).toEqual([]);
});

test("on the managed environment with the placeholder domain in force, the flag refuses naming the variable and the fix", () => {
  expect(acmeDns01Errors(managed, {})).toEqual([
    "environment vps turns on acme-dns01, which needs the platform domain: the overlay holds the placeholder kore.internal; set KORE_PLATFORM_DOMAIN in the shell that runs kore to the platform domain, or turn acme-dns01 off",
  ]);
});

test("with the run-time domain set, the flag has no error", () => {
  expect(
    acmeDns01Errors(managed, { KORE_PLATFORM_DOMAIN: exampleDomain }),
  ).toEqual([]);
});

test("a chart argument is never built while the placeholder is in force, so a render cannot carry the placeholder zone", () => {
  expect(() => acmeDns01HelmArgs(managed, "kore-local-tls", {})).toThrow(
    /KORE_PLATFORM_DOMAIN/,
  );
});

test("with the flag on, the platform certificate takes the suborg names as a JSON list, so the chart renders a wildcard pair for each", () => {
  expect(
    acmeDns01HelmArgs(
      managed,
      "kore-local-tls",
      { KORE_PLATFORM_DOMAIN: exampleDomain },
      ["reference", "team-a"],
    ),
  ).toEqual([
    "--set-string",
    `acmeDns01.zone=${exampleDomain}`,
    "--set-json",
    `acmeDns01.suborgs=["reference","team-a"]`,
  ]);
});

test("with no suborg records the argument list is what it was before, so a suborg with no Organization manifest renders no wildcard", () => {
  expect(
    acmeDns01HelmArgs(
      managed,
      "kore-local-tls",
      { KORE_PLATFORM_DOMAIN: exampleDomain },
      [],
    ),
  ).toEqual(["--set-string", `acmeDns01.zone=${exampleDomain}`]);
});

test("with the flag off, suborg names add no argument", () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(
    acmeDns01HelmArgs(
      managed,
      "kore-local-tls",
      { KORE_PLATFORM_DOMAIN: exampleDomain },
      ["reference"],
    ),
  ).toEqual([]);
});

test("with the flag on, the platform certificate takes the foreign names as a JSON list, one Certificate each (issue 1678)", () => {
  expect(
    acmeDns01HelmArgs(
      managed,
      "kore-local-tls",
      { KORE_PLATFORM_DOMAIN: exampleDomain },
      [],
      ["pay.example.net", "shop.example.org"],
    ),
  ).toEqual([
    "--set-string",
    `acmeDns01.zone=${exampleDomain}`,
    "--set-json",
    `acmeDns01.foreignNames=["pay.example.net","shop.example.org"]`,
  ]);
});

test("with no foreign name, the argument list gains nothing, so a render with no foreign record is what it was before", () => {
  expect(
    acmeDns01HelmArgs(
      managed,
      "kore-local-tls",
      { KORE_PLATFORM_DOMAIN: exampleDomain },
      ["reference"],
      [],
    ),
  ).toEqual([
    "--set-string",
    `acmeDns01.zone=${exampleDomain}`,
    "--set-json",
    `acmeDns01.suborgs=["reference"]`,
  ]);
});

test("with the flag off, foreign names add no argument and no component takes them", () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(
    acmeDns01HelmArgs(
      managed,
      "kore-local-tls",
      { KORE_PLATFORM_DOMAIN: exampleDomain },
      [],
      ["shop.example.org"],
    ),
  ).toEqual([]);
  expect(
    acmeDns01HelmArgs(
      managed,
      "cert-manager",
      { KORE_PLATFORM_DOMAIN: exampleDomain },
      [],
      ["shop.example.org"],
    ),
  ).toEqual([]);
});
