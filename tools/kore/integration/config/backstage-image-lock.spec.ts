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

test("the release job builds, pushes, signs and verifies the Backstage image by digest", async () => {
  const release = job(await workflow(), "release");
  const step = release.slice(
    release.indexOf("- name: Build, push, sign and verify the Backstage image"),
  );
  assert.match(step, /BACKSTAGE_IMAGE: ghcr\.io\/corekraft\/kore\/backstage/);
  assert.match(
    step,
    /docker build --tag "\$BACKSTAGE_IMAGE:\$TAG" images\/backstage/,
  );
  assert.match(step, /docker push "\$BACKSTAGE_IMAGE:\$TAG"/);
  assert.match(
    step,
    /echo "BACKSTAGE_DIGEST=\$BACKSTAGE_DIGEST" >> "\$GITHUB_ENV"/,
  );
  assert.match(
    step,
    /cosign sign --yes "\$\{BACKSTAGE_IMAGE\}@\$\{BACKSTAGE_DIGEST\}"/,
  );
  assert.match(step, /--certificate-identity "\$IDENTITY"/);
});

test("the Backstage lock is its own file, names one image by digest and the one signer", async () => {
  const release = job(await workflow(), "release");
  const step = release.slice(
    release.indexOf("- name: Write the Backstage image lock"),
  );
  assert.match(step, /backstage-image\.lock\.json/);
  assert.match(step, /authorizedSigners: \[\$signer\]/);
  assert.match(
    step,
    /backstage: \{image: \$image, digest: \$digest, signer: \$signer\}/,
  );
  assert.doesNotMatch(
    step.slice(0, step.indexOf("upload-artifact")),
    /static-frontend|kotlin-bff/,
  );
});

test("the Backstage lock is verified entry by entry before upload and written after the earlier locks", async () => {
  const release = job(await workflow(), "release");
  const write = release.indexOf("- name: Write the Backstage image lock");
  const verify = release.indexOf("- name: Verify every Backstage lock entry");
  const upload = release.indexOf("name: backstage-image.lock.json");
  assert.ok(write > release.indexOf("name: template-images.lock.json"));
  assert.ok(verify > write && upload > verify);
  const step = release.slice(verify, upload);
  assert.match(step, /cosign verify/);
  assert.match(step, /--certificate-oidc-issuer "\$ISSUER"/);
});

test("a separate job attaches the Backstage lock with only the write-assets scope and never replaces a different one", async () => {
  const attach = job(await workflow(), "attach-backstage-lock");
  assert.match(attach, /needs: release/);
  assert.match(attach, /if: github\.ref_type == 'tag'/);
  assert.match(attach, /permissions:\n\s+contents: write\n\s+env:/);
  assert.doesNotMatch(attach, /id-token|packages:/);
  assert.match(attach, /gh release upload "\$TAG" backstage-image\.lock\.json/);
  assert.match(attach, /cmp published\/backstage-image\.lock\.json/);
  assert.match(attach, /refusing to replace it/);
});

test("the Kore Backstage image is in the approved catalog at the release digest, and not in the reference or template locks", async () => {
  const root = await findRoot();
  const approved = await readFile(
    join(root, "infra/catalog/approved-images.yaml"),
    "utf8",
  );
  const digest =
    "sha256:a47f1b52eb19b2619305bf35c179885472a4b5fc50b4e9dd8c2fee5ececdd866";
  assert.match(
    approved,
    new RegExp(
      '"image": "ghcr\\.io/corekraft/kore/backstage@' +
        digest +
        '",\\n\\s+"name": "backstage",\\n\\s+"component": "kore-platform-backstage"',
    ),
  );
  assert.equal(approved.split("kore/backstage").length - 1, 1);
  assert.doesNotMatch(
    await readFile(join(root, "infra/catalog/images.lock.json"), "utf8"),
    /kore\/backstage/,
  );
  const release = job(await workflow(), "release");
  const templates = release.slice(
    release.indexOf("- name: Write the template image lock"),
    release.indexOf("- name: Verify every template lock entry"),
  );
  assert.doesNotMatch(templates, /BACKSTAGE/);
});
