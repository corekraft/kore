import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  acmeCertificateIssuer,
  externalGatewayAcmeIssuersErrors,
  featureEnabled,
  featureHelmArgs,
  loadRepository,
  platformHelmArgs,
  validateRepository,
  type Repository,
} from "../../src/config/index.js";

// Docs: docs/decisions/0157-a-name-under-another-domain-is-served-after-an-http-01-proof-and-certificates-come-from-acme.md
// Docs: docs/decisions/0161-cert-manager-solves-dns-01-through-cloudflare-and-issues-per-suborg-wildcards-behind-acme-dns01.md
// Issue 1637: the acme-issuers flag adds an HTTP-01 solver to the two issuers acme-dns01 renders, dark until a live outcome.

const run = promisify(execFile);
const flag = "acme-issuers";
const dnsFlag = "acme-dns01";
const chartPath = "infra/charts/platform-certificate";
// The domain is the documentation value example.com, never a real one.
const exampleDomain = "example.com";
const runTime = { KORE_PLATFORM_DOMAIN: exampleDomain };

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

/** Each document of a kind in a render, split on the document separator. */
function documentsOf(rendered: string, kind: string): string[] {
  return rendered
    .split(/^---$/m)
    .filter((document) => new RegExp(`^kind: ${kind}$`, "m").test(document));
}

const issuersOf = (rendered: string) => documentsOf(rendered, "ClusterIssuer");

test("vps declares acme-issuers false, and local and managed-example do not list it, because the flag applies to vps alone", async () => {
  const vps = await loadRepository("vps");
  assert.equal(vps.environment.features?.[flag], false);
  assert.equal(featureEnabled(vps.environment, flag), false);
  for (const name of ["local", "managed-example"]) {
    const repository = await loadRepository(name);
    assert.equal(repository.environment.features?.[flag], undefined, name);
    assert.equal(featureEnabled(repository.environment, flag), false, name);
  }
});

test("with acme-issuers off, the two issuers render with the DNS-01 solver only, so no HTTP-01 solver renders", async () => {
  const rendered = await renderCertificate(
    await withFlags("vps", { [dnsFlag]: true }),
  );
  const issuers = issuersOf(rendered);
  assert.equal(issuers.length, 2);
  for (const issuer of issuers) {
    assert.equal(/^\s*http01:/m.test(issuer), false);
    assert.match(issuer, /^\s*dns01:/m);
  }
});

test("with acme-issuers on, each of the two issuers carries an HTTP-01 solver on the external Gateway's port 80 listener, listed first", async () => {
  const rendered = await renderCertificate(
    await withFlags("vps", { [dnsFlag]: true, [flag]: true }),
  );
  const issuers = issuersOf(rendered);
  assert.equal(issuers.length, 2);
  for (const issuer of issuers) {
    const httpAt = issuer.search(
      /^\s*- selector:\n\s+matchLabels:\n\s+platform\.kore\.dev\/acme-challenge: "?http01"?$/m,
    );
    const dnsAt = issuer.search(/^\s*dns01:/m);
    assert.ok(
      httpAt >= 0,
      "the HTTP-01 solver selects by its Certificate label",
    );
    assert.ok(
      httpAt < dnsAt,
      "the HTTP-01 solver is listed before the DNS-01 solver",
    );
    assert.match(
      issuer,
      /gatewayHTTPRoute:\n\s+parentRefs:\n\s+- group: gateway\.networking\.k8s\.io\n\s+kind: Gateway\n\s+name: kore-gateway-external\n\s+namespace: kore-system\n\s+sectionName: http/,
    );
  }
});

test("with acme-issuers on, the DNS-01 solver still selects the platform zone and names the cloudflare-token Secret, and renders no token", async () => {
  const issuers = issuersOf(
    await renderCertificate(
      await withFlags("vps", { [dnsFlag]: true, [flag]: true }),
    ),
  );
  for (const issuer of issuers) {
    assert.match(issuer, /dnsZones:\n\s+- "example\.com"/);
    assert.match(
      issuer,
      /apiTokenSecretRef:\n\s+name: cloudflare-token\n\s+key: api-token/,
    );
    assert.equal(/api-token:\s*\S/.test(issuer), false);
  }
});

test("with acme-issuers on, the issuers name the same two ClusterIssuers acme-dns01 renders, so there is one owner per name", async () => {
  const names = issuersOf(
    await renderCertificate(
      await withFlags("vps", { [dnsFlag]: true, [flag]: true }),
    ),
  ).map((issuer) => /^  name: (\S+)$/m.exec(issuer)?.[1]);
  assert.deepEqual(names, ["letsencrypt-staging", "letsencrypt-production"]);
  assert.equal(names[0], acmeCertificateIssuer());
});

test("the issuers carry no ACME account email, and the render has no address, no real domain and no token", async () => {
  const rendered = await renderCertificate(
    await withFlags("vps", { [dnsFlag]: true, [flag]: true }),
  );
  const issuers = issuersOf(rendered).join("\n");
  assert.equal(/^\s*email:/m.test(issuers), false);
  assert.equal(/\b\d{1,3}(\.\d{1,3}){3}\b/.test(rendered), false);
  assert.equal(rendered.includes("kore.internal"), false);
  assert.equal(/api-token:\s*\S/.test(rendered), false);
});

test("every Certificate in the render that names a Let's Encrypt issuer names the staging issuer, and the scan runs over the Certificates the render holds", async () => {
  const rendered = await renderCertificate(
    await withFlags("vps", { [dnsFlag]: true, [flag]: true }),
  );
  const certificates = documentsOf(rendered, "Certificate");
  assert.ok(
    certificates.length >= 1,
    "the platform Certificate is in the render",
  );
  for (const certificate of certificates) {
    const issuer = /issuerRef:\n\s+kind: ClusterIssuer\n\s+name: (\S+)/.exec(
      certificate,
    )?.[1];
    if (issuer?.startsWith("letsencrypt-")) {
      assert.equal(issuer, acmeCertificateIssuer());
    }
  }
});

test("external-gateway on in vps without acme-issuers is refused by validation, naming both flags and the fix", async () => {
  await assert.rejects(
    validateRepository(
      await withFlags("vps", {
        "service-listener-sets": true,
        "platform-shared-gateway": true,
        "external-gateway": true,
        [dnsFlag]: true,
      }),
    ),
    /environment vps turns on external-gateway, which needs acme-issuers, but acme-issuers is off there; set "acme-issuers": true in the vps overlay, or turn external-gateway off/,
  );
});

test("external-gateway on in local and managed-example is not refused for acme-issuers, because acme-issuers does not apply there", async () => {
  for (const name of ["local", "managed-example"]) {
    const repository = await withFlags(name, {
      "service-listener-sets": true,
      "platform-shared-gateway": true,
      "external-gateway": true,
    });
    assert.deepEqual(
      externalGatewayAcmeIssuersErrors(
        repository.environment,
        repository.flags,
      ),
      [],
      name,
    );
  }
});

test("the real vps overlay, with external-gateway and acme-issuers both off, has no external-gateway error", async () => {
  const repository = await loadRepository("vps");
  assert.deepEqual(
    externalGatewayAcmeIssuersErrors(repository.environment, repository.flags),
    [],
  );
});

test("acme-issuers on without acme-dns01 is refused by validation, naming both flags", async () => {
  await assert.rejects(
    validateRepository(await withFlags("vps", { [flag]: true })),
    /flag acme-issuers is on in the vps overlay but requires acme-dns01, which is off there; set "acme-dns01": true in the vps overlay/,
  );
});

test("local refuses acme-issuers on, because its entry applies to vps alone", async () => {
  await assert.rejects(
    validateRepository(await withFlags("local", { [flag]: true })),
    /acme-issuers/,
  );
});
