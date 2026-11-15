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
    /^FROM nginxinc\/nginx-unprivileged:1\.31\.7-alpine@sha256:[0-9a-f]{64}$/m,
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

test("nothing deploys the static frontend template yet", async () => {
  const lock = await read("infra/catalog/approved-images.yaml");
  assert.doesNotMatch(lock, /static-frontend/);
});
