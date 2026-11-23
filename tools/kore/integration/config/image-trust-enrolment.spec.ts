import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot, loadRepository } from "../../src/config/index.js";

// Docs: docs/decisions/0181-namespaces-delivered-from-git-are-enrolled-in-image-admission-by-their-creator.md

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

test("the VPS and managed-example overlays admit the v0.22.0 release signer, and stay in warn", async () => {
  const v022 =
    "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.22.0";
  for (const environment of ["vps", "managed-example"]) {
    const repository = await loadRepository(environment);
    const trust: unknown = repository.imageTrustValues?.["trust"];
    assert.ok(isRecord(trust), `${environment} declares a trust authority`);
    assert.ok(
      Array.isArray(trust["subjects"]) && trust["subjects"].includes(v022),
      `${environment} trusts the v0.22.0 release signer`,
    );
    assert.equal(trust["mode"], "warn", `${environment} stays in warn`);
  }
});

const enrolmentLabel = "policy.sigstore.dev/include";

// The only files that may carry the enrolment label: the two creators of the
// golden-path namespaces, each behind golden-path-template-admission (ADR 0181).
// Any other chart or overlay that carries it fails this guard.
const flagGatedEnrolmentFiles = [
  "infra/charts/golden-path-delivery/templates/applicationset.yaml",
  "infra/charts/platform-apis/templates/service-composition.yaml",
];

test("the only namespace enrolment in git is the golden-path creators' label, behind golden-path-template-admission", async () => {
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
