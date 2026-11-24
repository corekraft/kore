import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot, loadRepository } from "../../src/config/index.js";

// Docs: docs/decisions/0181-namespaces-delivered-from-git-are-enrolled-in-image-admission-by-their-creator.md

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const v022 =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.22.0";
const v025 =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.25.0";
const v027 =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.27.0";

test("every overlay gives the template policy its own keyless trust, admitting its release signers, in warn", async () => {
  for (const environment of ["local", "vps", "managed-example"]) {
    const repository = await loadRepository(environment);
    const templates: unknown = repository.imageTrustValues?.["templates"];
    const trust: unknown = isRecord(templates) ? templates["trust"] : undefined;
    assert.ok(isRecord(trust), `${environment} declares templates.trust`);
    assert.equal(
      trust["type"],
      "keyless",
      `${environment} templates.trust is keyless`,
    );
    assert.equal(
      trust["issuer"],
      "https://token.actions.githubusercontent.com",
      `${environment} templates.trust uses the GitHub Actions issuer`,
    );
    assert.deepEqual(
      trust["subjects"],
      environment === "local" ? [v027, v025, v022] : [v025, v022],
      `${environment} templates.trust admits its release signers (local also v0.27.0)`,
    );
    assert.equal(
      trust["mode"],
      "warn",
      `${environment} templates.trust stays in warn`,
    );
  }
});

test("the platform policy of vps and managed-example no longer admits v0.22.0, which only the template policy needs; the platform stays in warn", async () => {
  for (const environment of ["vps", "managed-example"]) {
    const repository = await loadRepository(environment);
    const trust: unknown = repository.imageTrustValues?.["trust"];
    assert.ok(isRecord(trust), `${environment} declares a trust authority`);
    assert.ok(
      Array.isArray(trust["subjects"]) && !trust["subjects"].includes(v022),
      `${environment} platform trust no longer lists v0.22.0`,
    );
    assert.equal(trust["mode"], "warn", `${environment} stays in warn`);
  }
});

test("local keeps its key platform trust untouched", async () => {
  const repository = await loadRepository("local");
  assert.deepEqual(repository.imageTrustValues?.["trust"], {
    type: "key",
    mode: "enforce",
    signaturePullSecret: "kore-registry-read",
    keyRef: { name: "kore-local-signing-pub", namespace: "cosign-system" },
  });
});

const enrolmentLabel = "policy.sigstore.dev/include";

// The only files that may carry the enrolment label: the two creators of the
// golden-path namespaces, behind golden-path-template-admission (ADR 0181), and
// the Organization composition, which enrols each suborg namespace behind
// suborg-tenancy (ADR 0165, issue 1550). Any other chart or overlay that carries
// it fails this guard.
const flagGatedEnrolmentFiles = [
  "infra/charts/golden-path-delivery/templates/applicationset.yaml",
  "infra/charts/platform-apis/templates/service-composition.yaml",
  "infra/charts/platform-apis/templates/organization-composition.yaml",
];

test("the only namespace enrolment in git is a namespace creator's label, each behind its own flag (ADR 0181, ADR 0165)", async () => {
  const root = await findRoot();
  const carriers: string[] = [];
  for (const dir of ["infra/charts", "infra/environments"]) {
    const files = (await readdir(join(root, dir), { recursive: true })).filter(
      (f) => /\.(ya?ml|tpl)$/.test(f),
    );
    for (const file of files) {
      const body = await readFile(join(root, dir, file), "utf8");
      if (body.includes(enrolmentLabel)) {
        carriers.push(`${dir}/${file}`);
      }
    }
  }
  assert.deepEqual(
    carriers.sort(),
    [...flagGatedEnrolmentFiles].sort(),
    "only the golden-path creators may carry the enrolment label",
  );
  for (const file of flagGatedEnrolmentFiles) {
    const body = await readFile(join(root, file), "utf8");
    assert.equal(
      body.split(enrolmentLabel).length - 1,
      1,
      `${file} carries the enrolment label exactly once`,
    );
  }
});
