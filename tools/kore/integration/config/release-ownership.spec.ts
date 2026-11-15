import assert from "node:assert/strict";
import { test } from "vitest";
import {
  helmInstalledComponents,
  loadRepository,
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

test("with platform-argocd-delivery on, exactly the six configuration releases are argocd-owned and Helm installs none of them", async () => {
  const repository = await loadRepository("local");
  const on = {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        [platformArgocdDeliveryFlag]: true,
      },
    },
  };
  await validateRepository(on);
  const owned = on.catalog.components
    .filter((c) => releaseOwner(on.environment, c) === "argocd")
    .map((c) => c.name)
    .sort();
  assert.deepEqual(owned, [...handedOver].sort());
  const helm = helmInstalledComponents(on).map((c) => c.name);
  for (const name of handedOver) {
    assert.equal(helm.includes(name), false, name);
  }
  assert.equal(helm.includes("kore-image-policy"), true);
  assert.equal(helm.includes("argocd"), true);
});
