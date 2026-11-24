import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  findRoot,
  loadRepository,
  organizationServiceApisFlag,
  validateRepository,
  type Repository,
} from "../../src/config/index.js";
import {
  helmTemplateArgs,
  withAbsoluteChart,
} from "../../src/platform/index.js";

// Docs: docs/decisions/0042-organization-domains-by-delegation.md
// The Organization API owns the zone the hostname-ownership constraint reads
// (issue 1331). The zone is rendered into the XRD only behind the
// platform-hostname-ownership flag, which is off, so the flag off renders what
// it rendered before.

const flag = "platform-hostname-ownership";
const component = "kore-platform-apis";

async function read(path: string): Promise<string> {
  return await readFile(join(await findRoot(), path), "utf8");
}

async function localWith(value: boolean): Promise<Repository> {
  const repository = await loadRepository("local");
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: { ...repository.environment.features, [flag]: value },
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

test("with the flag on the Organization XRD carries a validated zone defaulting to the environment's organization under its platform domain", async () => {
  const repository = await localWith(true);
  const { domain, organizationId } = repository.environment.platform ?? {};
  const xrd = await organizationXrd(repository);
  const zone = xrd.split(/^ {16}zone:$/m)[1]?.split(/^ {16}\S/m)[0] ?? "";
  assert.match(zone, /^ {18}type: string$/m);
  assert.ok(
    zone.includes(`default: "${organizationId}.${domain}"`),
    "the default is the organization identifier under the platform domain",
  );
  assert.match(zone, /^ {18}maxLength: 253$/m);
  assert.match(
    zone,
    /^ {18}pattern: "\^\(\[a-z0-9\]\(\[-a-z0-9\]\{0,61\}\[a-z0-9\]\)\?\\\\\.\)\+\[a-z0-9\]\(\[-a-z0-9\]\{0,61\}\[a-z0-9\]\)\?\$"$/m,
  );
});

test("with the flag off the Organization XRD names no zone", async () => {
  const xrd = await organizationXrd(await localWith(false));
  assert.doesNotMatch(xrd, /zone/);
});

test("with the flag on the XRD differs from the flag-off XRD only by the zone, so tenant and parent are unchanged", async () => {
  const on = await organizationXrd(await localWith(true));
  const off = await organizationXrd(await localWith(false));
  // The flag adds the zone property and the suborg zone rule that refuses a suborg zone other
  // than <suborg>.<platform domain> (ADR 0165); both are zone rules, so both come out here.
  const withoutZone = on
    .replace(/^ {16}# The zone[\s\S]*?^ {18}pattern: .*\n/m, "")
    .replace(/\n {12}# A suborg's default zone[\s\S]*?message: [^\n]*/, "");
  assert.notEqual(withoutZone, on, "the zone block was found and removed");
  assert.equal(withoutZone, off);
});

test("with the flag on and no organization identifier the render fails naming the missing value", async () => {
  const repository = await localWith(true);
  const found = repository.catalog.components.find((c) => c.name === component);
  assert.ok(found, `${component} is in the catalog`);
  const args = withAbsoluteChart(
    repository,
    found,
    helmTemplateArgs(repository, found),
  );
  const kept = args.filter(
    (arg, index) =>
      !arg.startsWith("platformOrganizationId=") &&
      !(args[index + 1] ?? "").startsWith("platformOrganizationId="),
  );
  await assert.rejects(
    promisify(execFile)("helm", kept),
    /platformOrganizationId is required while platform-hostname-ownership is on/,
  );
});

test("the constraint chart keeps no parameter list", async () => {
  const constraint = await read(
    "infra/charts/kore-hostname-ownership/templates/korehostnameownership.yaml",
  );
  assert.doesNotMatch(constraint, /parameters|zones/);
});

test("hostname ownership on with the platform APIs off is refused up front, naming the dependency", async () => {
  const repository = await localWith(true);
  const off: Repository = {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        [organizationServiceApisFlag]: false,
      },
    },
  };
  await assert.rejects(validateRepository(off), (error: Error) => {
    assert.ok(
      error.message
        .split("\n")
        .includes(
          "kore-policy-sync: depends on kore-platform-apis, which feature platform-organization-service-apis gates off; gate kore-policy-sync with the same flag or drop the dependency",
        ),
      error.message,
    );
    return true;
  });
});
