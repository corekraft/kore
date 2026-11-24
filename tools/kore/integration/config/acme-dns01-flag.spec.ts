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

/**
 * The platform certificate chart rendered as kore renders it, with the run-time domain
 * in force and the suborg names kore reads from the Organization records.
 */
async function renderCertificate(
  repository: Repository,
  suborgs: readonly string[] = [],
): Promise<string> {
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
    ...platformHelmArgs(
      repository.environment,
      component.name,
      runTime,
      suborgs,
    ),
  ]);
  return stdout;
}

/** Each ClusterIssuer document in a render, split on the document separator. */
function clusterIssuers(rendered: string): string[] {
  return rendered
    .split(/^---$/m)
    .filter((document) => /^kind: ClusterIssuer$/m.test(document));
}

/** Each Certificate document in a render, split on the document separator. */
function certificates(rendered: string): string[] {
  return rendered
    .split(/^---$/m)
    .filter((document) => /^kind: Certificate$/m.test(document));
}

/** The names a Certificate document covers, its dnsNames. */
function dnsNames(document: string): string[] {
  return [...document.matchAll(/^\s+- "([^"]+)"$/gm)].map((m) => m[1]!);
}

/** The wildcard Certificates of a render: those whose names are wildcards. */
function wildcards(rendered: string): string[] {
  return certificates(rendered).filter((document) =>
    dnsNames(document).some((name) => name.startsWith("*.")),
  );
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

test("with the flag on and two suborgs, the render holds exactly four wildcard Certificates: a platform and an internal wildcard for each suborg", async () => {
  const rendered = await renderCertificate(await withAcme("vps", true), [
    "reference",
    "team-a",
  ]);
  assert.deepEqual(wildcards(rendered).map(dnsNames), [
    ["*.reference.example.com"],
    ["*.reference.internal.example.com"],
    ["*.team-a.example.com"],
    ["*.team-a.internal.example.com"],
  ]);
});

test("the issuance count is two per suborg: a render holds 2N wildcard Certificates for N suborgs", async () => {
  for (const suborgs of [
    [],
    ["reference"],
    ["reference", "team-a", "team-b"],
  ]) {
    const rendered = await renderCertificate(
      await withAcme("vps", true),
      suborgs,
    );
    assert.equal(
      wildcards(rendered).length,
      2 * suborgs.length,
      suborgs.join(","),
    );
  }
});

test("every wildcard Certificate is issued by the staging issuer, and no Certificate references production (production waits for a staging Ready outcome)", async () => {
  const rendered = await renderCertificate(await withAcme("vps", true), [
    "reference",
  ]);
  for (const document of wildcards(rendered)) {
    assert.match(
      document,
      /issuerRef:\n\s+kind: ClusterIssuer\n\s+name: letsencrypt-staging/,
    );
  }
  assert.equal(
    certificates(rendered).some((document) =>
      /name: letsencrypt-production/.test(document),
    ),
    false,
  );
});

test("no per-service Certificate exists for a platform or internal name: every Certificate but the Gateway's own names a wildcard of a listed suborg", async () => {
  const rendered = await renderCertificate(await withAcme("vps", true), [
    "reference",
    "team-a",
  ]);
  const perName = certificates(rendered).filter(
    (document) => !/^  name: kore-local$/m.test(document),
  );
  assert.equal(perName.length, 4);
  for (const document of perName) {
    for (const name of dnsNames(document)) {
      assert.match(name, /^\*\.(reference|team-a)(\.internal)?\.example\.com$/);
    }
  }
  assert.match(
    rendered,
    /kind: Certificate\n[\s\S]*issuerRef:\n\s+kind: ClusterIssuer\n\s+name: kore-local-ca/,
  );
});

test("a suborg with no Organization manifest renders nothing: with no suborg names the render holds no wildcard and the issuers still render", async () => {
  const rendered = await renderCertificate(await withAcme("vps", true), []);
  assert.deepEqual(wildcards(rendered), []);
  assert.equal(clusterIssuers(rendered).length, 2);
});

test("with the flag off, suborg names change nothing: the render is byte-identical to the render without them", async () => {
  const off = await withAcme("vps", false);
  assert.equal(
    await renderCertificate(off, ["reference", "team-a"]),
    await renderCertificate(off),
  );
});

test("vps loads no suborg names, because it has no Organization manifest yet, so its render holds no wildcard", async () => {
  const repository = await loadRepository("vps");
  assert.deepEqual(repository.suborgs, []);
});

test("suborgs x and x-internal render distinct Certificates and secrets, because the kind comes before the suborg name", async () => {
  const rendered = await renderCertificate(await withAcme("vps", true), [
    "x",
    "x-internal",
  ]);
  const pairs = wildcards(rendered);
  assert.deepEqual(pairs.map(dnsNames), [
    ["*.x.example.com"],
    ["*.x.internal.example.com"],
    ["*.x-internal.example.com"],
    ["*.x-internal.internal.example.com"],
  ]);
  const names = pairs.map((document) => /^  name: (.+)$/m.exec(document)![1]);
  assert.deepEqual(names, [
    "suborg-wildcard-x",
    "suborg-internal-wildcard-x",
    "suborg-wildcard-x-internal",
    "suborg-internal-wildcard-x-internal",
  ]);
  const secrets = pairs.map(
    (document) => /^  secretName: (.+)$/m.exec(document)![1],
  );
  assert.deepEqual(
    secrets,
    names.map((name) => `${name}-tls`),
  );
});
