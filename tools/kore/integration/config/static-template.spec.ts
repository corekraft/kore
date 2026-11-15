import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

async function read(path: string): Promise<string> {
  return readFile(join(await findRoot(), path), "utf8");
}

test("the static frontend template is served from a static-server image pinned by tag and digest", async () => {
  const dockerfile = await read("templates/static-frontend/Dockerfile");
  assert.match(
    dockerfile,
    /^FROM nginxinc\/nginx-unprivileged:1\.31\.7-alpine3\.24@sha256:[0-9a-f]{64}$/m,
  );
  assert.equal(dockerfile.match(/^FROM /gm)?.length, 1);
});

test("the static frontend template runs unprivileged on a port above 1024 and copies the build into the image", async () => {
  const dockerfile = await read("templates/static-frontend/Dockerfile");
  assert.match(dockerfile, /^EXPOSE 8080$/m);
  assert.doesNotMatch(dockerfile, /^USER root/m);
  assert.match(dockerfile, /^COPY src\/ \/usr\/share\/nginx\/html\/$/m);
  assert.match(
    await read("templates/static-frontend/nginx.conf"),
    /listen 8080;/,
  );
});

test("the release job signs the static frontend template image by digest and verifies the exact identity", async () => {
  const workflow = await read(".github/workflows/release.yaml");
  assert.match(
    workflow,
    /TEMPLATE_IMAGE: ghcr\.io\/corekraft\/kore\/templates\/static-frontend/,
  );
  assert.match(
    workflow,
    /docker build --tag "\$TEMPLATE_IMAGE:\$TAG" templates\/static-frontend/,
  );
  assert.match(
    workflow,
    /cosign sign --yes "\$\{TEMPLATE_IMAGE\}@\$\{TEMPLATE_DIGEST\}"/,
  );
  assert.match(
    workflow,
    /cosign verify[^\n]*\\\n[^\n]*certificate-identity "\$IDENTITY"[\s\S]*?\$\{TEMPLATE_IMAGE\}@/,
  );
});

test("the static frontend base is the digest the catalog already records for the registry proxy seed", async () => {
  const dockerfile = await read("templates/static-frontend/Dockerfile");
  const base = /^FROM (\S+)$/m.exec(dockerfile)?.[1];
  assert.ok(base);
  assert.ok((await read("infra/catalog/seeds.yaml")).includes(base));
});

test("the hadolint scan covers the static frontend template Dockerfile", async () => {
  assert.match(
    await read(".mise.toml"),
    /hadolint apps\/reference\/Dockerfile templates\/static-frontend\/Dockerfile/,
  );
});

test("the static frontend sets and rewrites no cookie, so no session cookie or Domain can come from it", async () => {
  const nginx = await read("templates/static-frontend/nginx.conf");
  assert.doesNotMatch(nginx, /set-cookie|proxy_cookie_/i);
  assert.doesNotMatch(nginx, /Domain=/i);
  assert.doesNotMatch(
    await read("templates/static-frontend/Dockerfile"),
    /set-cookie|Domain=/i,
  );
});

test("nothing deploys the static frontend template yet", async () => {
  const lock = await read("infra/catalog/approved-images.yaml");
  assert.doesNotMatch(lock, /static-frontend/);
});
