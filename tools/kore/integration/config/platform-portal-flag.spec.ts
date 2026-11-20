import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import {
  approvedImageList,
  enabledComponents,
  featureEnabled,
  loadRepository,
  platformPortalFlag,
  portalStagedInstallFlag,
  startsAfterDelivery,
  validateRepository,
} from "../../src/config/index.js";

for (const name of ["local", "managed-example"]) {
  test(`${name} declares platform-portal off, so no portal component is ever installed`, async () => {
    const repository = await loadRepository(name);
    await validateRepository(repository);
    assert.equal(repository.environment.features?.[platformPortalFlag], false);
    assert.equal(
      featureEnabled(repository.environment, platformPortalFlag),
      false,
    );
    const gated = repository.catalog.components.filter(
      (c) => c.featureFlag === platformPortalFlag,
    );
    const installed = new Set(enabledComponents(repository).map((c) => c.name));
    for (const component of gated) {
      assert.equal(installed.has(component.name), false, component.name);
    }
  });
}

test("the Keycloak pins are exact, so no range or tag floats into the install that follows", async () => {
  const repository = await loadRepository("local");
  assert.match(
    repository.versions.components["keycloak-operator"] ?? "",
    /^\d+\.\d+\.\d+$/,
  );
  assert.match(
    repository.versions.components["provider-keycloak"] ?? "",
    /^v\d+\.\d+\.\d+$/,
  );
});

test("the Keycloak operator is a flag-gated chart that owns its CRDs, so with the flag off nothing reaches a cluster", async () => {
  const repository = await loadRepository("local");
  const operator = repository.catalog.components.find(
    (c) => c.name === "keycloak-operator",
  );
  assert.equal(operator?.featureFlag, platformPortalFlag);
  assert.equal(operator?.kind, "local-chart");
  assert.equal(operator?.namespace, "keycloak");
  assert.deepEqual(operator?.ownsCRDs.sort(), [
    "keycloakoidcclients.k8s.keycloak.org",
    "keycloakrealmimports.k8s.keycloak.org",
    "keycloaks.k8s.keycloak.org",
    "keycloaksamlclients.k8s.keycloak.org",
  ]);
  assert.deepEqual(operator?.ownsCRDGroups, ["k8s.keycloak.org"]);
  const installed = enabledComponents(repository).map((c) => c.name);
  assert.equal(installed.includes("keycloak-operator"), false);
});

test("the operator and server images are pinned by digest and named by the operator component, so the install deploys what was verified", async () => {
  const repository = await loadRepository("local");
  const images = repository.approved.images.filter((i) =>
    i.name.startsWith("keycloak"),
  );
  assert.deepEqual(images.map((i) => i.name).sort(), [
    "keycloak-operator",
    "keycloak-server",
  ]);
  for (const image of images) {
    assert.match(image.image, /@sha256:[0-9a-f]{64}$/);
    assert.equal(image.component, "keycloak-operator");
  }
});

async function imageValues(root: string, file: string): Promise<string[]> {
  const values = JSON.parse(await readFile(join(root, file), "utf8"));
  return [values.operator.image, values.keycloak.image];
}

test("the local values name exactly the approved images, so the operator and the servers it starts run the digests", async () => {
  const repository = await loadRepository("local");
  const approved = approvedImageList(repository).map((i) => i.image);
  const images = await imageValues(
    repository.root,
    "infra/environments/common/values/keycloak-operator.yaml",
  );
  assert.deepEqual(
    images.sort(),
    approved.filter((i) => i.includes("keycloak/")).sort(),
  );
});

test("the chart takes both images from values and carries no tag, so nothing it renders floats", async () => {
  const repository = await loadRepository("local");
  const text = await readFile(
    join(
      repository.root,
      "infra/charts/keycloak-operator/templates/operator.yaml",
    ),
    "utf8",
  );
  assert.equal(text.includes("quay.io"), false);
  assert.equal(
    [...text.matchAll(/\.Values\.(operator|keycloak)\.image/g)].length,
    3,
  );
});

test("managed-example overlays both images with mirror references at the same digests, so no managed cluster pulls from quay.io", async () => {
  const repository = await loadRepository("managed-example");
  const local = await imageValues(
    repository.root,
    "infra/environments/common/values/keycloak-operator.yaml",
  );
  const files =
    repository.environment.componentValues?.["keycloak-operator"] ?? [];
  assert.equal(files.length, 1);
  const mirrored = await imageValues(repository.root, files[0]!);
  const digest = (image: string) => image.split("@")[1];
  assert.deepEqual(mirrored.map(digest), local.map(digest));
  for (const image of mirrored) {
    assert.match(image, /^ghcr\.io\/corekraft\/kore\/mirror\/keycloak/);
  }
});

test("the chart ships no OpenShift ingress grant, so the operator holds no cluster-scoped read the platform does not need", async () => {
  const repository = await loadRepository("local");
  const text = await readFile(
    join(
      repository.root,
      "infra/charts/keycloak-operator/templates/operator.yaml",
    ),
    "utf8",
  );
  assert.equal(text.includes("config.openshift.io"), false);
  assert.equal(text.includes("keycloak-operator-clusterrole"), false);
});

for (const name of ["local", "vps", "managed-example"]) {
  test(`${name} declares portal-staged-install off, so no release is staged until its live proof`, async () => {
    const repository = await loadRepository(name);
    await validateRepository(repository);
    assert.equal(
      repository.environment.features?.[portalStagedInstallFlag],
      false,
    );
    const staged = repository.catalog.components.filter((c) =>
      startsAfterDelivery(repository.environment, c),
    );
    assert.deepEqual(staged, []);
  });
}

test("only the platform Keycloak and Backstage declare they start after the Argo CD delivery, and each is gated by platform-portal", async () => {
  const repository = await loadRepository("local");
  const declared = repository.catalog.components.filter(
    (c) => c.startsAfterDelivery === true,
  );
  assert.deepEqual(
    declared.map((c) => c.name),
    ["kore-platform-keycloak", "kore-platform-backstage"],
  );
  for (const component of declared) {
    assert.equal(component.featureFlag, platformPortalFlag, component.name);
    assert.equal(component.phase, "configuration", component.name);
    assert.notEqual(component.owner, "argocd", component.name);
  }
});

test("Backstage is staged after Keycloak, which it depends on, so the two start in that order", async () => {
  const repository = await loadRepository("local");
  const backstage = repository.catalog.components.find(
    (c) => c.name === "kore-platform-backstage",
  );
  assert.equal(
    backstage?.dependencies.includes("kore-platform-keycloak"),
    true,
  );
});
