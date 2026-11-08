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
  assert.match(template, /127\.0\.0\.1:5001/);
  assert.match(template, /name: proxy/);
  assert.match(template, /\.Values\.proxy\.image\.digest/);
  assert.doesNotMatch(
    template,
    /containerPort: 5001/,
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
