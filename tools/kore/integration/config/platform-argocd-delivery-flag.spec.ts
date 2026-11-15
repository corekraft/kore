import assert from "node:assert/strict";
import { test } from "vitest";
import {
  approvedImageList,
  enabledComponents,
  featureEnabled,
  loadRepository,
  orderedComponents,
  platformArgocdDeliveryFlag,
  validateRepository,
} from "../../src/config/index.js";

for (const name of ["local", "managed-example"]) {
  test(`${name} declares platform-argocd-delivery off, so Argo CD is cataloged but never installed and Helm owns every release`, async () => {
    const repository = await loadRepository(name);
    await validateRepository(repository);
    assert.equal(
      repository.environment.features?.[platformArgocdDeliveryFlag],
      false,
    );
    assert.equal(
      featureEnabled(repository.environment, platformArgocdDeliveryFlag),
      false,
    );
    const argocd = repository.catalog.components.find(
      (c) => c.name === "argocd",
    );
    assert.equal(argocd?.featureFlag, platformArgocdDeliveryFlag);
    assert.equal(argocd?.phase, "core");
    assert.equal(argocd?.kind, "helm");
    assert.equal(
      enabledComponents(repository).some((c) => c.name === "argocd"),
      false,
    );
  });
}

test("turning the flag on installs Argo CD after the controllers it needs, so the gate is the only thing between it and a cluster", async () => {
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
  assert.equal(
    enabledComponents(on).some((c) => c.name === "argocd"),
    true,
  );
  const names = orderedComponents(repository.catalog).map((c) => c.name);
  assert.ok(names.indexOf("argocd") > names.indexOf("cert-manager"));
});

test("the Argo CD pins agree, so one chart version and exact image digests are the only ones in the catalog", async () => {
  const repository = await loadRepository("local");
  const images = approvedImageList(repository).filter((i) =>
    i.name.startsWith("argocd"),
  );
  assert.deepEqual(images.map((i) => i.name).sort(), [
    "argocd",
    "argocd-redis",
  ]);
  for (const image of images) {
    assert.match(image.image, /@sha256:[0-9a-f]{64}$/);
  }
});
