import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  findRoot,
  loadRepository,
  platformPortalFlag,
  type Repository,
} from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";

// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md

const run = promisify(execFile);

// Every chart the platform-portal flag gates. Each renders with the flag on and
// the values kore passes it (the --set features.* list and the values files),
// so a closed values schema that refuses one of them fails here, not in a live run.
const portalCharts = [
  "keycloak-operator",
  "keycloak-provider",
  "kore-platform-backstage",
  "kore-platform-keycloak",
  "kore-service-observability",
];

async function portalOn(environment: string): Promise<Repository> {
  const base = await loadRepository(environment);
  return {
    ...base,
    environment: {
      ...base.environment,
      features: { ...base.environment.features, [platformPortalFlag]: true },
    },
  };
}

for (const environment of ["local", "managed-example"]) {
  test(`each platform-portal chart renders in ${environment} with the feature values kore passes, so helm accepts every values schema`, async () => {
    const root = await findRoot();
    const repository = await portalOn(environment);
    const gated = repository.catalog.components
      .filter(
        (c) => c.featureFlag === platformPortalFlag && c.kind === "local-chart",
      )
      .map((c) => c.name)
      .sort();
    assert.deepEqual(gated, portalCharts);
    for (const name of portalCharts) {
      const component = repository.catalog.components.find(
        (c) => c.name === name,
      );
      assert.ok(component, name);
      const args = helmTemplateArgs(repository, component);
      const { stdout } = await run("helm", args, { cwd: root }).catch(
        (error: Error) => {
          throw new Error(
            `${name} does not render in ${environment}: ${error.message}`,
          );
        },
      );
      assert.match(stdout, /^kind: /m, name);
    }
  }, 120_000);
}
