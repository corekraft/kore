import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot, loadRepository } from "./config.js";

// Docs: docs/decisions/0058-registry-transport-tls.md

async function read(path: string): Promise<string> {
  return await readFile(join(await findRoot(), path), "utf8");
}
const chart = (path: string) => read(`infra/charts/oci-registry/${path}`);

test("the proxy serves TLS only: no listener answers plain HTTP", async () => {
  const conf = await chart("templates/proxy-config.yaml");
  const listens = [...conf.matchAll(/^\s*listen\s+([^;]+);/gm)].map(
    (match) => match[1] ?? "",
  );
  assert.ok(listens.length > 0);
  for (const listen of listens) {
    assert.match(listen, /\bssl\b/, `listener "${listen}" must be TLS`);
  }
  assert.match(conf, /ssl_certificate\s+\/etc\/nginx\/tls\/tls\.crt/);
  assert.match(conf, /ssl_certificate_key\s+\/etc\/nginx\/tls\/tls\.key/);
  assert.match(conf, /ssl_protocols\s+TLSv1\.2 TLSv1\.3/);
  assert.doesNotMatch(conf, /error_page 497/, "no http-to-https redirect");
});

test("the serving certificate is issued by a kore-owned CA whose key stays in the cluster", async () => {
  const tls = await chart("templates/tls.yaml");
  assert.match(tls, /kind: Issuer[\s\S]*selfSigned/);
  assert.match(tls, /isCA: true/);
  assert.match(tls, /secretName: oci-registry-ca/);
  assert.match(tls, /ca:\s*\n\s*secretName: oci-registry-ca/);
  assert.match(tls, /secretName: oci-registry-tls/);
  assert.doesNotMatch(tls, /ClusterIssuer/, "the CA is not a shared issuer");
  assert.doesNotMatch(tls, /BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)/);
});

test("the certificate covers the in-cluster address and the loopback the host reaches through the port-forward", async () => {
  const tls = await chart("templates/tls.yaml");
  assert.match(tls, /ipAddresses:/);
  assert.match(tls, /- "127\.0\.0\.1"/);
  assert.match(tls, /platform\.registry\.address/);
  assert.match(tls, /oci-registry\.\{\{ \.Release\.Namespace \}\}\.svc/);
});

test("the proxy mounts the issued certificate Secret", async () => {
  const all = await chart("templates/all.yaml");
  assert.match(all, /secretName: oci-registry-tls/);
  assert.match(all, /mountPath: \/etc\/nginx\/tls/);
});

test("the registry is issued after cert-manager and Policy Controller starts after the registry", async () => {
  const { catalog } = await loadRepository("local");
  const byName = new Map(catalog.components.map((c) => [c.name, c]));
  assert.ok(byName.get("oci-registry")?.dependencies.includes("cert-manager"));
  assert.ok(
    byName.get("policy-controller")?.dependencies.includes("oci-registry"),
  );
  assert.ok(
    byName
      .get("oci-registry")
      ?.readiness.includes("certificate/oci-registry-tls"),
  );
});

test("Policy Controller trusts the registry CA through the chart's CA bundle value, only in the local overlay", async () => {
  const local = JSON.parse(
    (await read("infra/environments/local/values/policy-controller.yaml"))
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n"),
  ) as { webhook: { registryCaBundle?: { name: string; key: string } } };
  assert.deepEqual(local.webhook.registryCaBundle, {
    name: "kore-registry-ca",
    key: "ca.crt",
  });
  assert.doesNotMatch(
    await read("infra/environments/common/values/policy-controller.yaml"),
    /registryCaBundle/,
  );
});
