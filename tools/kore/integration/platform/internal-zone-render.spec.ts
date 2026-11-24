import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "vitest";
import { loadRepository, type Repository } from "../../src/config/index.js";
import {
  helmTemplateArgs,
  withAbsoluteChart,
} from "../../src/platform/index.js";

// Docs: docs/decisions/0042-organization-domains-by-delegation.md
// Spec #1612, issue #1629: the Organization XRD carries an internal zone beside its
// zone. The field and its rules are rendered only while platform-hostname-ownership
// is on, so the flag-off XRD is the one the chart rendered before.

const flag = "platform-hostname-ownership";
const component = "kore-platform-apis";
const external = {
  namespace: "kore-system",
  name: "kore-gateway-external",
  port: 443,
  issuer: "acme-production",
};

/** The vps fixture: a split domain with an external Gateway, so the internal domain is internal.<domain>. */
async function vps(on: boolean): Promise<Repository> {
  const repository = await loadRepository("vps");
  const { environment } = repository;
  const internal = environment.gateways?.internal;
  assert.ok(internal, "the vps overlay declares gateways.internal");
  return {
    ...repository,
    environment: {
      ...environment,
      platform: {
        domain: "example.com",
        organizationId: "platform",
        internalDomain: "internal.example.com",
      },
      gateways: { internal, external },
      features: { ...environment.features, [flag]: on },
    },
  };
}

async function local(on: boolean): Promise<Repository> {
  const repository = await loadRepository("local");
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: { ...repository.environment.features, [flag]: on },
    },
  };
}

async function organizationXrd(repository: Repository): Promise<string> {
  const found = repository.catalog.components.find((c) => c.name === component);
  assert.ok(found, `${component} is in the catalog`);
  const { stdout } = await promisify(execFile)(
    "helm",
    withAbsoluteChart(repository, found, helmTemplateArgs(repository, found)),
  );
  const xrd = stdout
    .split(/^---$/m)
    .find((doc) => /^ {2}name: organizations\.platform\.kore\.dev$/m.test(doc));
  assert.ok(xrd, "the Organization XRD renders");
  return xrd;
}

/** The internal zone property as rendered: from its name to the next property. */
function internalZoneProperty(xrd: string): string {
  return xrd.split(/^ {16}internalZone:$/m)[1]?.split(/^ {16}\S/m)[0] ?? "";
}

test("on a vps fixture the platform organization's internal zone defaults to platform under the internal domain, beside its public zone", async () => {
  const xrd = await organizationXrd(await vps(true));
  const zone = internalZoneProperty(xrd);
  assert.match(zone, /^ {18}type: string$/m);
  assert.match(
    zone,
    /^ {18}default: "platform\.internal\.example\.com"$/m,
    "the default is the organization identifier under the internal domain",
  );
  assert.match(zone, /^ {18}maxLength: 253$/m);
});

test("on a vps fixture a suborg must state its own internal zone under the internal domain, and the refusal names the default", async () => {
  const xrd = await organizationXrd(await vps(true));
  assert.ok(
    xrd.includes(
      `            - rule: "self.metadata.name == 'platform' || (has(self.spec.internalZone) && self.spec.internalZone == self.metadata.name + '.internal.example.com')"\n              message: "spec.internalZone must be the suborg's default internal zone, <suborg>.internal.example.com: the platform internal zone default is for the platform organization only"`,
    ),
    "the suborg rule names <suborg>.internal.example.com as the only accepted value",
  );
});

test("on a vps fixture an explicit internal zone outside the internal domain is refused, with the exact text", async () => {
  const xrd = await organizationXrd(await vps(true));
  assert.ok(
    xrd.includes(
      `            - rule: "!has(self.spec.internalZone) || self.spec.internalZone.endsWith('.internal.example.com')"\n              message: "spec.internalZone must be inside the internal domain internal.example.com: set it to <suborg>.internal.example.com"`,
    ),
    "the inside-the-domain rule carries its exact message",
  );
});

test("on a vps fixture an internal zone equal to the public zone is refused, with the exact text", async () => {
  const xrd = await organizationXrd(await vps(true));
  assert.ok(
    xrd.includes(
      `            - rule: "!has(self.spec.internalZone) || self.spec.internalZone != self.spec.zone"\n              message: "spec.internalZone must differ from spec.zone: the two zones of one organization never coincide on a platform with an external Gateway"`,
    ),
    "the two zones never coincide, with the exact message",
  );
});

test("on local the internal zone defaults to the public zone, since its one domain is both the public and the internal domain", async () => {
  const xrd = await organizationXrd(await local(true));
  assert.match(
    internalZoneProperty(xrd),
    /^ {18}default: "platform\.kore\.internal"$/m,
  );
  assert.match(
    xrd,
    /^ {18}default: "platform\.kore\.internal"$/m,
    "the public zone default is the same value",
  );
  assert.ok(
    !xrd.includes("self.spec.internalZone != self.spec.zone"),
    "the one-domain platform has no coincidence rule, since its zones are the same by design",
  );
});

test("with platform-hostname-ownership off the Organization XRD names no internal zone and no internal domain", async () => {
  for (const repository of [await local(false), await vps(false)]) {
    const xrd = await organizationXrd(repository);
    assert.ok(!xrd.includes("internalZone"), "no internalZone field");
    assert.ok(!xrd.includes("internal.example.com"), "no internal domain");
  }
});
