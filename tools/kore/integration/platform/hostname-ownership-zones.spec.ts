import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  findRoot,
  loadRepository,
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
  const xrd = await organizationXrd(await localWith(true));
  const zone = xrd.split(/^ {16}zone:$/m)[1]?.split(/^ {16}\S/m)[0] ?? "";
  assert.match(zone, /^ {18}type: string$/m);
  assert.match(zone, /^ {18}default: "platform\.kore\.local"$/m);
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

test("the constraint reads zones from the Organization and keeps no parameter list", async () => {
  const template = await read(
    "infra/charts/kore-hostname-ownership-templates/templates/korehostnameownership.yaml",
  );
  assert.match(
    template,
    /data\.inventory\.cluster\["platform\.kore\.dev\/v1alpha1"\]\["Organization"\]\[owner\]/,
  );
  assert.match(template, /organization\.spec\.zone/);
  assert.doesNotMatch(template, /input\.parameters/);
  assert.doesNotMatch(template, /openAPIV3Schema/);
  const constraint = await read(
    "infra/charts/kore-hostname-ownership/templates/korehostnameownership.yaml",
  );
  assert.doesNotMatch(constraint, /parameters|zones/);
});

test("the policy sync replicates Organizations, and installs after the API that owns them", async () => {
  const sync = await read(
    "infra/charts/kore-policy-sync/templates/config.yaml",
  );
  assert.match(
    sync,
    /\{ group: platform\.kore\.dev, version: v1alpha1, kind: Organization \}/,
  );
  const repository = await loadRepository("local");
  const policySync = repository.catalog.components.find(
    (c) => c.name === "kore-policy-sync",
  );
  assert.deepEqual(policySync?.dependencies, ["gatekeeper", component]);
});
