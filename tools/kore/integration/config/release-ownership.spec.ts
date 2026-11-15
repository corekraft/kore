import assert from "node:assert/strict";
import { test } from "vitest";
import {
  helmInstalledComponents,
  loadRepository,
  organizationServiceApisFlag,
  platformArgocdDeliveryFlag,
  releaseOwner,
  validateRepository,
} from "../../src/config/index.js";

const handedOver = [
  "opa-authorizer",
  "kore-postgresql-api",
  "kore-policy-templates",
  "kore-policy-constraints",
  "kore-local-tls",
  "kore-platform-config",
];

for (const name of ["local", "managed-example"]) {
  test(`${name} with platform-argocd-delivery off is owned entirely by kore, so Helm installs what it installed before`, async () => {
    const repository = await loadRepository(name);
    await validateRepository(repository);
    for (const component of repository.catalog.components) {
      assert.equal(releaseOwner(repository.environment, component), "kore");
    }
  });
}

test("with platform-argocd-delivery on, exactly the six configuration releases are argocd-owned, Helm installs none of them, and golden-path delivery stays kore-owned", async () => {
  const repository = await loadRepository("local");
  const on = {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        [platformArgocdDeliveryFlag]: true,
        // kore-golden-path-delivery depends on kore-platform-apis.
        [organizationServiceApisFlag]: true,
      },
    },
  };
  await validateRepository(on);
  const owned = on.catalog.components
    .filter((c) => releaseOwner(on.environment, c) === "argocd")
    .map((c) => c.name)
    .sort();
  assert.deepEqual(owned, [...handedOver].sort());
  const helm = helmInstalledComponents(on, true).map((c) => c.name);
  for (const name of handedOver) {
    assert.equal(helm.includes(name), false, name);
  }
  const before = helmInstalledComponents(on, false).map((c) => c.name);
  for (const name of handedOver) {
    assert.equal(before.includes(name), true, `${name} stays with Helm`);
  }
  assert.equal(helm.includes("kore-image-policy"), true);
  assert.equal(helm.includes("kore-golden-path-delivery"), true);
  assert.equal(helm.includes("argocd"), true);
});
