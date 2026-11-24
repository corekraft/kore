import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0116-application-runtime-images-are-distroless-builder-stages-can-be-anything.md
// The kore-backup image (issue 1639): built, signed and locked by the release
// workflow like the Backstage image, with its own lock and no deployment.

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

test("the release job builds the kore-backup image from the program's context with its own Dockerfile, pushes it and signs it by digest", async () => {
  const release = job(await workflow(), "release");
  const step = release.slice(
    release.indexOf(
      "- name: Build, push, sign and verify the kore-backup image",
    ),
  );
  assert.match(
    step,
    /KORE_BACKUP_IMAGE: ghcr\.io\/corekraft\/kore\/kore-backup/,
  );
  assert.match(
    step,
    /docker build --file images\/kore-backup\/Dockerfile --tag "\$KORE_BACKUP_IMAGE:\$TAG" tools\/kore/,
  );
  assert.match(step, /docker push "\$KORE_BACKUP_IMAGE:\$TAG"/);
  assert.match(
    step,
    /echo "KORE_BACKUP_DIGEST=\$KORE_BACKUP_DIGEST" >> "\$GITHUB_ENV"/,
  );
  assert.match(
    step,
    /cosign sign --yes "\$\{KORE_BACKUP_IMAGE\}@\$\{KORE_BACKUP_DIGEST\}"/,
  );
  assert.match(step, /--certificate-identity "\$IDENTITY"/);
  assert.match(step, /--certificate-oidc-issuer "\$ISSUER"/);
});

test("the kore-backup lock is its own file, names one image by digest and the one release signer", async () => {
  const release = job(await workflow(), "release");
  const step = release.slice(
    release.indexOf("- name: Write the kore-backup image lock"),
  );
  assert.match(step, /kore-backup-image\.lock\.json/);
  assert.match(step, /authorizedSigners: \[\$signer\]/);
  assert.match(
    step,
    /"kore-backup": \{image: \$image, digest: \$digest, signer: \$signer\}/,
  );
  assert.doesNotMatch(
    step.slice(0, step.indexOf("upload-artifact")),
    /backstage|static-frontend|kotlin-bff/,
  );
});

test("the kore-backup lock is verified entry by entry before upload and written after the Backstage lock", async () => {
  const release = job(await workflow(), "release");
  const write = release.indexOf("- name: Write the kore-backup image lock");
  const verify = release.indexOf("- name: Verify every kore-backup lock entry");
  const upload = release.indexOf("name: kore-backup-image.lock.json");
  assert.ok(write > release.indexOf("name: backstage-image.lock.json"));
  assert.ok(verify > write && upload > verify);
  const step = release.slice(verify, upload);
  assert.match(step, /cosign verify/);
  assert.match(step, /--certificate-oidc-issuer "\$ISSUER"/);
});

test("a separate job attaches the kore-backup lock with only the write-assets scope and never replaces a different one", async () => {
  const attach = job(await workflow(), "attach-kore-backup-lock");
  assert.match(attach, /needs: release/);
  assert.match(attach, /if: github\.ref_type == 'tag'/);
  assert.match(attach, /permissions:\n\s+contents: write\n\s+env:/);
  assert.doesNotMatch(attach, /id-token|packages:/);
  assert.match(
    attach,
    /gh release upload "\$TAG" kore-backup-image\.lock\.json/,
  );
  assert.match(attach, /cmp published\/kore-backup-image\.lock\.json/);
  assert.match(attach, /refusing to replace it/);
});

test("nothing deploys the kore-backup image: no chart, environment or local image lock names it", async () => {
  const root = await findRoot();
  const files = [
    "infra/catalog/images.lock.json",
    ...(await readdir(join(root, "infra/charts"), { recursive: true }))
      .filter((name) => /\.(ya?ml|tpl)$/.test(name))
      .map((name) => join("infra/charts", name)),
    ...(await readdir(join(root, "infra/environments"), { recursive: true }))
      .filter((name) => /\.(ya?ml|json)$/.test(name))
      .map((name) => join("infra/environments", name)),
  ];
  for (const file of files) {
    const text = await readFile(join(root, file), "utf8");
    assert.doesNotMatch(text, /kore\/kore-backup|kore-backup-image/, file);
  }
});

test("the kore-backup image is listed in the approved catalog at the v0.26.0 release digest, signed by that tag's release workflow, and not in the local image lock", async () => {
  const root = await findRoot();
  const approvedText = await readFile(
    join(root, "infra/catalog/approved-images.yaml"),
    "utf8",
  );
  const approved: {
    images: {
      image: string;
      name: string;
      component: string;
      evidence: { provenance: unknown };
    }[];
  } = JSON.parse(approvedText);
  const entries = approved.images.filter(
    (entry) => entry.name === "kore-backup",
  );
  assert.deepEqual(
    entries.map(({ image, component, evidence }) => ({
      image,
      component,
      provenance: evidence.provenance,
    })),
    [
      {
        image:
          "ghcr.io/corekraft/kore/kore-backup@sha256:f14a740bf3c4a4e461bd8fcbf73ecb7c6cd6318c55497a02d0522fbfe17fe448",
        component: "kore-postgresql-api",
        provenance: {
          signed: true,
          issuer: "https://token.actions.githubusercontent.com",
          identity:
            "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.26.0",
        },
      },
    ],
  );
  assert.doesNotMatch(
    await readFile(join(root, "infra/catalog/images.lock.json"), "utf8"),
    /kore-backup/,
  );
});
