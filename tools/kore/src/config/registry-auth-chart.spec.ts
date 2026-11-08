import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot, loadRepository } from "./config.js";

async function chartFile(path: string): Promise<string> {
  return await readFile(
    join(await findRoot(), "infra/charts/oci-registry", path),
    "utf8",
  );
}

test("the registry is reachable only through the authenticating proxy", async () => {
  const template = await chartFile("templates/all.yaml");
  assert.match(template, /REGISTRY_HTTP_ADDR/);
  assert.match(template, /127\.0\.0\.1:5080/);
  assert.match(template, /name: proxy/);
  assert.match(template, /\.Values\.proxy\.image\.digest/);
  assert.doesNotMatch(
    template,
    /containerPort: 50[0-9]{2}(?<!5000)/,
    "the registry's own port is never published",
  );
});

test("unauthenticated requests are challenged and the read identity cannot write", async () => {
  const conf = await chartFile("templates/proxy-config.yaml");
  assert.match(conf, /auth_basic\s+"/);
  assert.match(conf, /auth_basic_user_file \/etc\/nginx\/auth\/htpasswd/);
  // Only a non-empty, non-push user is forbidden: an empty user must reach
  // auth_basic so clients receive the 401 challenge they need to log in.
  assert.match(conf, /\(\?!kore-push\$\)/);
  assert.match(conf, /return 403/);
  assert.match(conf, /GET\s+0/);
  assert.match(conf, /HEAD\s+0/);
  assert.doesNotMatch(conf, /auth_basic\s+off/);
});

test("the proxy mounts the generated hash Secret, not a committed credential", async () => {
  const template = await chartFile("templates/all.yaml");
  assert.match(template, /secretName: oci-registry-auth/);
  assert.doesNotMatch(template, /htpasswd:/);
  assert.doesNotMatch(await chartFile("values.yaml"), /\{SHA\}|password/i);
});

test("the Service is cluster-internal: no NodePort exposes the registry", async () => {
  const template = await chartFile("templates/all.yaml");
  const values = await chartFile("values.yaml");
  assert.match(template, /type: ClusterIP/);
  assert.doesNotMatch(template, /NodePort|nodePort/);
  assert.doesNotMatch(values, /nodePort/);
});

test("readiness is a bounded TCP check that does not depend on the 401 from /v2/", async () => {
  const template = await chartFile("templates/all.yaml");
  assert.match(template, /tcpSocket/);
  assert.doesNotMatch(template, /httpGet/);
  assert.match(template, /timeoutSeconds: 2/);
});

test("the proxy image is a digest-pinned catalog image the chart deploys", async () => {
  const repository = await loadRepository("local");
  const reference = repository.versions.images["oci-registry-proxy"] ?? "";
  assert.match(reference, /@sha256:[0-9a-f]{64}$/);
  const values = await chartFile("values.yaml");
  assert.ok(values.includes(reference.split("@")[1]!), "values carry digest");
});

test("the registry's listen and debug servers use distinct loopback ports the proxy targets", async () => {
  // registry:3's stock config runs a debug server on :5001 on every interface;
  // sharing that port crashes the registry, and an unbound debug server would
  // serve /metrics around the proxy.
  const template = await chartFile("templates/all.yaml");
  const conf = await chartFile("templates/proxy-config.yaml");
  const env = (name: string) =>
    new RegExp(`name: ${name}, value: "([^"]+)"`).exec(template)?.[1];
  const listen = env("REGISTRY_HTTP_ADDR");
  const debug = env("REGISTRY_HTTP_DEBUG_ADDR");
  assert.ok(listen && debug, "both addresses are set explicitly");
  assert.match(listen, /^127\.0\.0\.1:\d+$/);
  assert.match(debug, /^127\.0\.0\.1:\d+$/);
  assert.notEqual(listen, debug);
  assert.match(
    conf,
    new RegExp(`proxy_pass http://${listen.replace(/\./g, "\\.")};`),
  );
  assert.match(
    template,
    new RegExp(`nc, -z, 127\\.0\\.0\\.1, "${listen.split(":")[1]}"`),
  );
});
