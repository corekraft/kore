import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  featureEnabled,
  loadRepository,
  platformHelmArgs,
  readinessGatedOff,
  validateRepository,
  featureHelmArgs,
  type Repository,
} from "../../src/config/index.js";

// Docs: docs/decisions/0161-cert-manager-solves-dns-01-through-cloudflare-and-issues-per-suborg-wildcards-behind-acme-dns01.md

const run = promisify(execFile);
const flag = "acme-dns01";
const chartPath = "infra/charts/platform-certificate";
// The domain is the documentation value example.com, never a real one.
const exampleDomain = "example.com";
const runTime = { KORE_PLATFORM_DOMAIN: exampleDomain };

/** The overlay with acme-dns01 set as given; every other flag is the overlay's own. */
async function withAcme(name: string, on: boolean): Promise<Repository> {
  const base = await loadRepository(name);
  return {
    ...base,
    environment: {
      ...base.environment,
      features: { ...base.environment.features, [flag]: on },
    },
  };
}

/** The platform certificate chart rendered as kore renders it, with the run-time domain in force. */
async function renderCertificate(repository: Repository): Promise<string> {
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-local-tls",
  )!;
  const { stdout } = await run("helm", [
    "template",
    component.name,
    join(repository.root, chartPath),
    "--namespace",
    component.namespace,
    ...featureHelmArgs(repository.environment),
    ...platformHelmArgs(repository.environment, component.name, runTime),
  ]);
  return stdout;
}

/** Each ClusterIssuer document in a render, split on the document separator. */
function clusterIssuers(rendered: string): string[] {
  return rendered
    .split(/^---$/m)
    .filter((document) => /^kind: ClusterIssuer$/m.test(document));
}

test("vps declares acme-dns01 off, so no Let's Encrypt issuer is rendered (dark until a live outcome)", async () => {
  const repository = await loadRepository("vps");
  assert.equal(repository.environment.features?.[flag], false);
  assert.equal(featureEnabled(repository.environment, flag), false);
  assert.deepEqual(clusterIssuers(await renderCertificate(repository)), []);
});

for (const name of ["local", "managed-example"]) {
  test(`${name} does not list acme-dns01, because the flag applies to vps alone (it needs a real zone)`, async () => {
    const repository = await loadRepository(name);
    assert.equal(repository.environment.features?.[flag], undefined, name);
    assert.equal(featureEnabled(repository.environment, flag), false, name);
  });
}

test("with the flag on, vps renders the staging and production issuers, each selecting only the platform zone", async () => {
  const rendered = await renderCertificate(await withAcme("vps", true));
  const issuers = clusterIssuers(rendered);
  assert.equal(issuers.length, 2);
  const [staging, production] = issuers;
  assert.match(staging!, /^  name: letsencrypt-staging$/m);
  assert.match(
    staging!,
    /server: https:\/\/acme-staging-v02\.api\.letsencrypt\.org\/directory/,
  );
  assert.match(production!, /^  name: letsencrypt-production$/m);
  assert.match(
    production!,
    /server: https:\/\/acme-v02\.api\.letsencrypt\.org\/directory/,
  );
  for (const issuer of issuers) {
    assert.match(issuer!, /dnsZones:\n\s+- "example\.com"/);
    assert.match(
      issuer!,
      /apiTokenSecretRef:\n\s+name: cloudflare-token\n\s+key: api-token/,
    );
  }
});

test("the issuers select the platform zone only: no other domain appears in the issuers, and no ACME account email is rendered", async () => {
  const rendered = await renderCertificate(await withAcme("vps", true));
  const issuers = clusterIssuers(rendered).join("\n");
  assert.equal(issuers.includes("kore.internal"), false);
  assert.equal(/^\s*email:/m.test(issuers), false);
});

test("with the flag on, the placeholder zone is never rendered, so the zone is the run-time domain", async () => {
  const rendered = await renderCertificate(await withAcme("vps", true));
  assert.equal(rendered.includes("kore.internal"), false);
});

test("the staging and production issuers carry the account key Secrets kore never commits, and no token", async () => {
  const issuers = clusterIssuers(
    await renderCertificate(await withAcme("vps", true)),
  ).join("\n");
  assert.match(issuers, /name: letsencrypt-staging-account-key/);
  assert.match(issuers, /name: letsencrypt-production-account-key/);
  assert.equal(/api-token:\s*\S/.test(issuers), false);
});

test("with the flag on, the platform certificate keeps its in-cluster CA: the Gateway's issuer is unchanged for non-public names", async () => {
  const rendered = await renderCertificate(await withAcme("vps", true));
  assert.match(
    rendered,
    /kind: Certificate\n[\s\S]*issuerRef:\n\s+kind: ClusterIssuer\n\s+name: kore-local-ca/,
  );
});

test("local refuses acme-dns01 on, naming the flag and the fix, because a k3d zone is not public", async () => {
  await assert.rejects(
    validateRepository(await withAcme("local", true)),
    /turns on acme-dns01, which needs a real zone[\s\S]*turn acme-dns01 off in the local environment overlay/,
  );
});

test("the vps overlay validates with acme-dns01 off, so the placeholder domain is never refused for a dark flag", async () => {
  assert.deepEqual(await validateRepository(await loadRepository("vps")), []);
});

test("the issuers are gated by the flag in the readiness list, so none is waited on while the flag is off", async () => {
  const repository = await loadRepository("vps");
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-local-tls",
  )!;
  const issuers = [
    "clusterissuer.cert-manager.io/letsencrypt-staging",
    "clusterissuer.cert-manager.io/letsencrypt-production",
  ];
  for (const resource of issuers) {
    assert.ok(component.readiness.includes(resource), resource);
  }
  const off = await withAcme("vps", false);
  const on = await withAcme("vps", true);
  for (const resource of issuers) {
    assert.equal(
      readinessGatedOff(off.environment, component, resource),
      true,
      `${resource} with the flag off`,
    );
    assert.equal(
      readinessGatedOff(on.environment, component, resource),
      false,
      `${resource} with the flag on`,
    );
  }
});
