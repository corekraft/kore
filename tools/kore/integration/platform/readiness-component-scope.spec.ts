import { expect, test } from "vitest";
import {
  enabledComponents,
  loadRepository,
  type Component,
} from "../../src/config/index.js";
import type { Runner } from "../../src/runtime/index.js";
import { readinessFailure } from "../../src/testing/index.js";

// The component readiness of kore-config-delivery, with the real catalog, the
// real local flags and the real readiness path, and no cluster (issue 1880).
// While the golden-path sign-in waits for the portal, its Degraded golden-path
// Applications must not fail the release; the unit specs cover the failing cases.

const applications = JSON.stringify({
  items: [
    {
      metadata: { name: "opa-authorizer" },
      status: { sync: { status: "Synced" }, health: { status: "Healthy" } },
    },
    {
      metadata: {
        name: "golden-path-example",
        labels: { "platform.kore.dev/service": "golden-path-example" },
      },
      status: { sync: { status: "Synced" }, health: { status: "Degraded" } },
    },
  ],
});

test("the component's Application readiness passes while only a golden-path Application is Degraded, with the local flags", async () => {
  const loaded = await loadRepository("local");
  // The after-portal flag is off in the overlay; turn it on in memory only, never in the tracked overlay.
  const repository = {
    ...loaded,
    environment: {
      ...loaded.environment,
      features: {
        ...loaded.environment.features,
        "golden-path-signin-after-portal": true,
      },
    },
  };
  const delivery = enabledComponents(repository).find(
    ({ name }) => name === "kore-config-delivery",
  );
  if (delivery === undefined) {
    throw new Error("kore-config-delivery is not enabled in the local overlay");
  }
  const component: Component = {
    ...delivery,
    readiness: ["applications.argoproj.io"],
    ownsCRDs: [],
  };
  const runner: Runner = {
    run: async () => ({ stdout: applications, stderr: "", code: 0 }),
  };

  await expect(
    readinessFailure(repository, runner, component),
  ).resolves.toBeUndefined();
});
