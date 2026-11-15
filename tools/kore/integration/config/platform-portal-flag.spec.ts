import assert from "node:assert/strict";
import { test } from "vitest";
import {
  enabledComponents,
  featureEnabled,
  loadRepository,
  platformPortalFlag,
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
