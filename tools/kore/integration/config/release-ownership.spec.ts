import assert from "node:assert/strict";
import { test } from "vitest";
import {
  enabledComponents,
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

test("managed-example with platform-argocd-delivery off is owned entirely by kore, so Helm installs what it installed before", async () => {
  const repository = await loadRepository("managed-example");
  await validateRepository(repository);
  for (const component of repository.catalog.components) {
    assert.equal(releaseOwner(repository.environment, component), "kore");
  }
});

test("local with platform-argocd-delivery turned off is owned entirely by kore again", async () => {
  const repository = await loadRepository("local");
  const off = {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        [platformArgocdDeliveryFlag]: false,
      },
    },
  };
  await validateRepository(off);
  for (const component of off.catalog.components) {
    assert.equal(releaseOwner(off.environment, component), "kore");
  }
});

test("local declares platform-argocd-delivery on, so exactly the six configuration releases are argocd-owned, Helm installs none of them, and golden-path delivery stays kore-owned", async () => {
  const on = await loadRepository("local");
  assert.equal(on.environment.features?.[organizationServiceApisFlag], true);
  await validateRepository(on);
  // A feature-gated release with its flag off is installed by neither owner (ADR 0077).
  const owned = enabledComponents(on)
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
