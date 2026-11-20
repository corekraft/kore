// Docs: docs/decisions/0140-otlp-is-routed-by-name-to-the-standard-collector-receiver-behind-otlp-route.md
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  helmInstalledComponents,
  loadRepository,
  platformHelmArgs,
  releaseOwner,
  type Repository,
} from "../../src/config/index.js";

// With platform-argocd-delivery on, only argocd-owned releases are handed to
// Argo CD. kore-otlp-route is owned by kore (ADR 0140), so it stays on the Helm
// path and takes its name and Gateway from the same arguments the Helm path
// passes, with the flag on. Nothing reaches the PostgreSQL-style Application
// branch in the delivery chart, because the route is not a handed-over release.

async function repositoryWith(
  flags: Record<string, boolean>,
): Promise<Repository> {
  const base = await loadRepository("local");
  return {
    ...base,
    environment: {
      ...base.environment,
      platform: { domain: "kore.internal", organizationId: "platform" },
      features: { ...base.environment.features, ...flags },
    },
  };
}

test("with platform-argocd-delivery and otlp-route on, the OTLP route stays on the Helm path and is not handed to Argo CD", async () => {
  const repository = await repositoryWith({
    "platform-argocd-delivery": true,
    "platform-shared-gateway": true,
    "otlp-route": true,
  });
  const route = repository.catalog.components.find(
    (component) => component.name === "kore-otlp-route",
  );
  assert.ok(route, "kore-otlp-route is in the catalog");
  assert.equal(releaseOwner(repository.environment, route), "kore");
  assert.ok(
    helmInstalledComponents(repository, true).includes(route),
    "the route is still installed by Helm once Argo CD delivery is installed",
  );
});

test("with the OTLP route on, the Helm path gives it its name and the shared Gateway it attaches to", async () => {
  const repository = await repositoryWith({
    "platform-argocd-delivery": true,
    "platform-shared-gateway": true,
    "otlp-route": true,
  });
  assert.deepEqual(
    platformHelmArgs(repository.environment, "kore-otlp-route"),
    [
      "--set-string",
      "otlpRoute.hostname=otlp.platform.kore.internal",
      "--set-string",
      `otlpRoute.gateway.name=${repository.environment.gateway.name}`,
      "--set-string",
      `otlpRoute.gateway.namespace=${repository.environment.gateway.namespace}`,
    ],
  );
});
