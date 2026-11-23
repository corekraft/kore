import assert from "node:assert/strict";
import { test } from "vitest";
import {
  featureEnabled,
  keycloakWaitFlag,
  loadRepository,
  validateRepository,
} from "../../src/config/index.js";

test("local declares platform-keycloak-wait present and off, so turning it on goes through a recorded live proof", async () => {
  const repository = await loadRepository("local");
  await validateRepository(repository);
  assert.equal(repository.environment.features?.[keycloakWaitFlag], false);
  assert.equal(featureEnabled(repository.environment, keycloakWaitFlag), false);
});

for (const name of ["vps", "managed-example"]) {
  test(`${name} does not turn platform-keycloak-wait on`, async () => {
    const repository = await loadRepository(name);
    await validateRepository(repository);
    assert.equal(
      featureEnabled(repository.environment, keycloakWaitFlag),
      false,
    );
  });
}
