// Docs: docs/decisions/0042-organization-domains-by-delegation.md
import { beforeEach, expect, test, vi } from "vitest";
import {
  internalZoneDefault,
  internalZoneErrors,
  suborgInternalZoneErrors,
} from "./internal-zone.js";
import { featureEnabled } from "./features.js";
import { internalDomainOf, platformPlan } from "./platform-domain.js";
import { suborgDefaultZone } from "./suborg-names.js";
import type { Environment } from "./types.js";

vi.mock("./features.js");
vi.mock("./platform-domain.js");
vi.mock("./suborg-names.js");

const file = "infra/environments/vps/organizations/api.json";

/** A suborg on a split-domain platform: public zone under example.com, internal zone under internal.example.com. */
const split = {
  file,
  organization: "api",
  zone: "api.example.com",
  domain: "example.com",
  internalDomain: "internal.example.com",
};

/** A one-domain platform, as local is: the internal domain is the platform domain. */
const oneDomain = {
  file,
  organization: "api",
  zone: "api.kore.internal",
  domain: "kore.internal",
  internalDomain: "kore.internal",
};

/** A suborg record that declares the given internal zone. */
const declaring = (internalZone: unknown) => ({
  apiVersion: "platform.kore.dev/v1alpha1",
  kind: "Organization",
  metadata: { name: "api" },
  spec: { tenant: "platform", parent: "platform", internalZone },
});

test("the default internal zone is the organization identifier under the internal domain", () => {
  expect(internalZoneDefault("api", "internal.example.com")).toBe(
    "api.internal.example.com",
  );
});

test("a suborg that states its default internal zone on a split-domain platform is accepted", () => {
  expect(
    internalZoneErrors({
      ...split,
      manifest: declaring("api.internal.example.com"),
    }),
  ).toEqual([]);
});

test("on a one-domain platform the default internal zone is the public zone, and stating it is accepted", () => {
  expect(
    internalZoneErrors({
      ...oneDomain,
      manifest: declaring("api.kore.internal"),
    }),
  ).toEqual([]);
});

test("a suborg with no internal zone is refused, naming the default it must state", () => {
  expect(
    internalZoneErrors({ ...split, manifest: declaring(undefined) }),
  ).toEqual([
    "infra/environments/vps/organizations/api.json.spec.internalZone: is required while platform-hostname-ownership is on; set it to api.internal.example.com, the suborg's default internal zone",
  ]);
});

test("a non-string internal zone is refused, naming the default", () => {
  expect(internalZoneErrors({ ...split, manifest: declaring(7) })).toEqual([
    "infra/environments/vps/organizations/api.json.spec.internalZone: must be a string, set it to api.internal.example.com, the suborg's default internal zone",
  ]);
});

test("an internal zone equal to the public zone is refused on a split-domain platform, naming the rule", () => {
  expect(
    internalZoneErrors({ ...split, manifest: declaring("api.example.com") }),
  ).toEqual([
    'infra/environments/vps/organizations/api.json.spec.internalZone "api.example.com" equals the public zone api.example.com: the two zones of one organization never coincide on a platform with an external Gateway; set it to api.internal.example.com, the suborg\'s default internal zone',
  ]);
});

test("an internal zone outside the internal domain is refused, naming the internal domain", () => {
  expect(
    internalZoneErrors({ ...split, manifest: declaring("api.example.org") }),
  ).toEqual([
    'infra/environments/vps/organizations/api.json.spec.internalZone "api.example.org" is outside the internal domain internal.example.com: set it to api.internal.example.com, the suborg\'s default internal zone',
  ]);
});

test("an internal zone inside the internal domain but not the suborg's own default is refused, naming the default", () => {
  expect(
    internalZoneErrors({
      ...split,
      manifest: declaring("shop.internal.example.com"),
    }),
  ).toEqual([
    "infra/environments/vps/organizations/api.json.spec.internalZone \"shop.internal.example.com\" must be the suborg's default internal zone api.internal.example.com: a suborg's internal zone is <suborg>.internal.example.com; set it to api.internal.example.com",
  ]);
});

test("a record that is not an object is left to the record's own rules", () => {
  expect(internalZoneErrors({ ...split, manifest: "api" })).toEqual([]);
});

const environment = { name: "vps" } as Environment;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(platformPlan).mockReturnValue({
    domain: "example.com",
    organizationId: "platform",
  });
  vi.mocked(internalDomainOf).mockReturnValue("internal.example.com");
  vi.mocked(suborgDefaultZone).mockImplementation(
    (name, domain) => `${name}.${domain}`,
  );
});

test("with platform-hostname-ownership off no suborg's internal zone is checked, so a record with none is accepted", () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(
    suborgInternalZoneErrors({
      environment,
      file,
      organization: "api",
      manifest: declaring(undefined),
    }),
  ).toEqual([]);
  expect(featureEnabled).toHaveBeenCalledWith(
    environment,
    "platform-hostname-ownership",
  );
});

test("with platform-hostname-ownership on a suborg's internal zone is checked against its public zone and the internal domain in force", () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  expect(
    suborgInternalZoneErrors({
      environment,
      env: {},
      file,
      organization: "api",
      manifest: declaring(undefined),
    }),
  ).toEqual([
    "infra/environments/vps/organizations/api.json.spec.internalZone: is required while platform-hostname-ownership is on; set it to api.internal.example.com, the suborg's default internal zone",
  ]);
  expect(platformPlan).toHaveBeenCalledWith(environment, {});
  expect(internalDomainOf).toHaveBeenCalledWith(environment, {});
});
