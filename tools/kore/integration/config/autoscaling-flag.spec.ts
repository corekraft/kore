import assert from "node:assert/strict";
import { test } from "vitest";
import {
  autoscalingFlag,
  enabledComponents,
  featureEnabled,
  loadRepository,
  validateRepository,
} from "../../src/config/index.js";

test("managed-example declares the autoscaling flag off, so metrics-server is cataloged but never installed", async () => {
  const repository = await loadRepository("managed-example");
  await validateRepository(repository);
  assert.equal(repository.environment.features?.[autoscalingFlag], false);
  assert.equal(featureEnabled(repository.environment, autoscalingFlag), false);
  const cataloged = repository.catalog.components.find(
    (c) => c.name === "metrics-server",
  );
  assert.equal(cataloged?.featureFlag, autoscalingFlag);
  assert.equal(
    enabledComponents(repository).some((c) => c.name === "metrics-server"),
    false,
  );
});

test("local declares the autoscaling flag on, so metrics-server is installed", async () => {
  const repository = await loadRepository("local");
  await validateRepository(repository);
  assert.equal(repository.environment.features?.[autoscalingFlag], true);
  assert.equal(featureEnabled(repository.environment, autoscalingFlag), true);
  assert.equal(
    enabledComponents(repository).some((c) => c.name === "metrics-server"),
    true,
  );
});

test("turning the flag off removes metrics-server, so the gate is the only thing between it and a cluster", async () => {
  const repository = await loadRepository("local");
  const off = {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        [autoscalingFlag]: false,
      },
    },
  };
  assert.equal(
    enabledComponents(off).some((c) => c.name === "metrics-server"),
    false,
  );
});
