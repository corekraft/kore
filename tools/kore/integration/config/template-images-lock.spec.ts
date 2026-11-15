import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

async function workflow(): Promise<string> {
  return readFile(
    join(await findRoot(), ".github/workflows/release.yaml"),
    "utf8",
  );
}

function job(text: string, name: string): string {
  const start = text.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `job ${name} exists`);
  const rest = text.slice(start + 1);
  const next = /\n  [a-z-]+:\n/.exec(rest.slice(1));
  return next ? rest.slice(0, next.index + 1) : rest;
}

test("each template step hands its signed digest to the later lock step", async () => {
  const release = job(await workflow(), "release");
  assert.match(
    release,
    /echo "TEMPLATE_DIGEST=\$TEMPLATE_DIGEST" >> "\$GITHUB_ENV"/,
  );
  assert.match(
    release,
    /echo "BFF_TEMPLATE_DIGEST=\$BFF_TEMPLATE_DIGEST" >> "\$GITHUB_ENV"/,
  );
});

test("the template lock names both images by digest and the one signer", async () => {
  const release = job(await workflow(), "release");
  const step = release.slice(
    release.indexOf("- name: Write the template image lock"),
  );
  assert.match(step, /template-images\.lock\.json/);
  assert.match(step, /authorizedSigners: \[\$signer\]/);
  assert.match(step, /static-frontend/);
  assert.match(step, /kotlin-bff/);
  assert.match(step, /\$TEMPLATE_IMAGE/);
  assert.match(step, /\$BFF_TEMPLATE_IMAGE/);
});

test("the lock is verified by cosign against the pinned identity, entry by entry, before it is uploaded", async () => {
  const release = job(await workflow(), "release");
  const write = release.indexOf("- name: Write the template image lock");
  const verify = release.indexOf("- name: Verify every template lock entry");
  const upload = release.indexOf("name: template-images.lock.json");
  assert.ok(write >= 0 && verify > write && upload > verify);
  const step = release.slice(verify, upload);
  assert.match(step, /jq -r '\.entries\[\] \| "\\\(\.image\)@\\\(\.digest\)"'/);
  assert.match(step, /cosign verify/);
  assert.match(step, /--certificate-identity "\$IDENTITY"/);
  assert.match(step, /--certificate-oidc-issuer "\$ISSUER"/);
});

test("the template lock is written after the reference image lock so a template failure cannot lose it", async () => {
  const release = job(await workflow(), "release");
  assert.ok(
    release.indexOf("- name: Write the template image lock") >
      release.indexOf("name: images.lock.json"),
  );
});

test("a separate job attaches the template lock to the release with only the write-assets scope and never replaces a different one", async () => {
  const attach = job(await workflow(), "attach-template-lock");
  assert.match(attach, /needs: release/);
  assert.match(attach, /if: github\.ref_type == 'tag'/);
  assert.match(attach, /permissions:\n\s+contents: write\n\s+env:/);
  assert.doesNotMatch(attach, /id-token|packages:/);
  assert.match(attach, /name: template-images\.lock\.json/);
  assert.match(attach, /gh release upload "\$TAG" template-images\.lock\.json/);
  assert.match(attach, /cmp published\/template-images\.lock\.json/);
  assert.match(attach, /refusing to replace it/);
});

test("the reference image lock and the catalog still do not mention the templates", async () => {
  const root = await findRoot();
  for (const file of [
    "infra/catalog/images.lock.json",
    "infra/catalog/approved-images.yaml",
    "infra/catalog/seeds.yaml",
  ]) {
    assert.doesNotMatch(
      await readFile(join(root, file), "utf8"),
      /templates\/|kotlin-bff|static-frontend/,
      file,
    );
  }
  const release = job(await workflow(), "release");
  const reference = release.slice(
    release.indexOf("- name: Write the image lock"),
    release.indexOf("- uses: actions/upload-artifact"),
  );
  assert.doesNotMatch(reference, /TEMPLATE/);
});
