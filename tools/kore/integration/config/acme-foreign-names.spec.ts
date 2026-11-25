import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  featureHelmArgs,
  loadRepository,
  platformHelmArgs,
  type Repository,
} from "../../src/config/index.js";

// Docs: docs/decisions/0157-a-name-under-another-domain-is-served-after-an-http-01-proof-and-certificates-come-from-acme.md
// Docs: docs/decisions/0161-cert-manager-solves-dns-01-through-cloudflare-and-issues-per-suborg-wildcards-behind-acme-dns01.md
// Issue 1678: a foreign name gets one HTTP-01 Certificate of its own, behind acme-dns01, and no DNS-01 solver for a foreign zone.

const run = promisify(execFile);
const dnsFlag = "acme-dns01";
const issuersFlag = "acme-issuers";
const chartPath = "infra/charts/platform-certificate";
// The domains are the documentation values example.com and example.net, never real ones.
const exampleDomain = "example.com";
const runTime = { KORE_PLATFORM_DOMAIN: exampleDomain };
const foreignNames = ["pay.example.net", "shop.example.org"];

/** The overlay with the given flags set; every other flag is the overlay's own. */
async function withFlags(
  name: string,
  features: Record<string, boolean>,
): Promise<Repository> {
  const base = await loadRepository(name);
  return {
    ...base,
    environment: {
      ...base.environment,
      features: { ...base.environment.features, ...features },
    },
  };
}

/** The platform certificate chart rendered as kore renders it, with the foreign names given. */
async function renderCertificate(
  repository: Repository,
  foreign: readonly string[] = [],
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
      [],
      foreign,
    ),
  ]);
  return stdout;
}

/** Each document of a kind in a render, split on the document separator. */
function documentsOf(rendered: string, kind: string): string[] {
  return rendered
    .split(/^---$/m)
    .filter((document) => new RegExp(`^kind: ${kind}$`, "m").test(document));
}

/** The Certificates whose only DNS name is the given one. */
function certificatesFor(rendered: string, name: string): string[] {
  return documentsOf(rendered, "Certificate").filter((document) =>
    document.includes(`dnsNames:\n    - "${name}"\n`),
  );
}

const issuersOf = (rendered: string) => documentsOf(rendered, "ClusterIssuer");

test("with acme-dns01 on, each foreign name gets one Certificate of its own that names only that name, and never a wildcard", async () => {
  const rendered = await renderCertificate(
    await withFlags("vps", { [dnsFlag]: true }),
    foreignNames,
  );
  for (const name of foreignNames) {
    const certificates = certificatesFor(rendered, name);
    assert.equal(certificates.length, 1, name);
    assert.equal(certificates[0]?.includes("*"), false, name);
  }
  const labelled = documentsOf(rendered, "Certificate").filter((document) =>
    document.includes('platform.kore.dev/acme-challenge: "http01"'),
  );
  assert.equal(
    labelled.length,
    foreignNames.length,
    "the only HTTP-01 Certificates are the foreign names, one each",
  );
});

test("each foreign Certificate selects the HTTP-01 solver by its label and takes the staging issuer, as platform names do", async () => {
  const rendered = await renderCertificate(
    await withFlags("vps", { [dnsFlag]: true }),
    foreignNames,
  );
  for (const name of foreignNames) {
    const [certificate] = certificatesFor(rendered, name);
    assert.match(
      certificate ?? "",
      /metadata:\n  name: foreign-[a-z0-9-]+-[0-9a-f]{8}\n  labels:\n    platform\.kore\.dev\/acme-challenge: "http01"\n/,
      name,
    );
    assert.match(
      certificate ?? "",
      /issuerRef:\n    kind: ClusterIssuer\n    name: letsencrypt-staging\n/,
      name,
    );
  }
});

test("with a foreign name and acme-issuers off, each issuer lists the labelled HTTP-01 solver on the external Gateway's port 80 before its DNS-01 solver", async () => {
  const issuers = issuersOf(
    await renderCertificate(
      await withFlags("vps", { [dnsFlag]: true }),
      foreignNames,
    ),
  );
  assert.equal(issuers.length, 2);
  for (const issuer of issuers) {
    const httpAt = issuer.search(
      /^\s*- selector:\n\s+matchLabels:\n\s+platform\.kore\.dev\/acme-challenge: "?http01"?$/m,
    );
    const dnsAt = issuer.search(/^\s*dns01:/m);
    assert.ok(httpAt >= 0, "the HTTP-01 solver selects by its label");
    assert.ok(httpAt < dnsAt, "the HTTP-01 solver is listed first");
    assert.match(
      issuer,
      /gatewayHTTPRoute:\n\s+parentRefs:\n\s+- group: gateway\.networking\.k8s\.io\n\s+kind: Gateway\n\s+name: kore-gateway-external\n\s+namespace: kore-system\n\s+sectionName: http/,
    );
  }
});

test("no DNS-01 solver selects a foreign zone, and no foreign Certificate or solver carries a credential for it", async () => {
  const rendered = await renderCertificate(
    await withFlags("vps", { [dnsFlag]: true }),
    foreignNames,
  );
  for (const issuer of issuersOf(rendered)) {
    assert.match(issuer, /dnsZones:\n\s+- "example\.com"\n/);
    assert.equal(/dnsZones:\n\s+- "example\.(net|org)"/.test(issuer), false);
  }
  for (const name of foreignNames) {
    for (const document of certificatesFor(rendered, name)) {
      assert.equal(/cloudflare/i.test(document), false, name);
    }
  }
});

test("two foreign names that differ only by a dot or a dash each get a Certificate of their own name, so neither overwrites the other", async () => {
  const rendered = await renderCertificate(
    await withFlags("vps", { [dnsFlag]: true }),
    ["a.example.org", "a-example.org"],
  );
  const names = documentsOf(rendered, "Certificate")
    .map((document) => /^  name: (\S+)$/m.exec(document)?.[1])
    .filter((name) => name?.startsWith("foreign-"));
  assert.equal(names.length, 2);
  assert.equal(new Set(names).size, 2);
});

test("with no foreign name, the render adds no foreign Certificate and, with acme-issuers off, no HTTP-01 solver", async () => {
  const rendered = await renderCertificate(
    await withFlags("vps", { [dnsFlag]: true }),
    [],
  );
  assert.equal(rendered.includes("platform.kore.dev/acme-challenge"), false);
  for (const issuer of issuersOf(rendered)) {
    assert.equal(/^\s*http01:/m.test(issuer), false);
  }
});

test("with acme-dns01 off, a foreign name renders nothing, so the render is the render without it", async () => {
  const off = await withFlags("vps", {
    [dnsFlag]: false,
    [issuersFlag]: false,
  });
  const withNames = await renderCertificate(off, foreignNames);
  const without = await renderCertificate(off, []);
  assert.equal(withNames, without);
  for (const name of foreignNames) {
    assert.equal(withNames.includes(name), false, name);
  }
});
