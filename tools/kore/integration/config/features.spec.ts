import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, validateRepository } from "../../src/config/index.js";
import { featureEnabled, featureHelmArgs } from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";
import type { Repository } from "../../src/config/index.js";

/** The repository without the catalog's own gated components. */
async function ungated(name: string): Promise<Repository> {
  const base = await loadRepository(name);
  return {
    ...base,
    catalog: {
      ...base.catalog,
      components: base.catalog.components.map((c) => {
        const plain = { ...c };
        delete plain.featureFlag;
        return plain;
      }),
    },
  };
}

async function featuresMessage(features: unknown): Promise<string> {
  const base = await ungated("local");
  try {
    await validateRepository({
      ...base,
      environment: { ...base.environment, features } as never,
    });
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

test("an overlay without a features map validates, with every flag off", async () => {
  const loaded = await ungated("managed-example");
  const { features: _declared, ...rest } = loaded.environment;
  const base: Repository = { ...loaded, environment: rest };
  await validateRepository(base);
  assert.equal(base.environment.features, undefined);
  assert.equal(featureEnabled(base.environment, "autoscaling-defaults"), false);
  assert.deepEqual(featureHelmArgs(base.environment), []);
});

test("a map of booleans validates and reads as on or off", async () => {
  assert.equal(
    await featuresMessage({
      "autoscaling-defaults": true,
      "platform-portal": false,
    }),
    "",
  );
  const environment = {
    features: { "autoscaling-defaults": true, "platform-portal": false },
  };
  assert.equal(
    featureEnabled(environment as never, "autoscaling-defaults"),
    true,
  );
  assert.equal(featureEnabled(environment as never, "quiet"), false);
  assert.equal(featureEnabled(environment as never, "absent"), false);
});

test("a non-boolean flag value is rejected naming the flag and the fix", async () => {
  const message = await featuresMessage({ "autoscaling-defaults": "true" });
  assert.match(
    message,
    /environment\.features\.autoscaling-defaults must be true or false/,
  );
});

test("a malformed flag name is rejected", async () => {
  const message = await featuresMessage({ Bad_Name: true });
  assert.match(
    message,
    /environment\.features name Bad_Name must be lowercase/,
  );
});

test("features that is not a map is rejected", async () => {
  assert.match(
    await featuresMessage(["autoscaling-defaults"]),
    /environment\.features must be a map of flag name to true or false/,
  );
});

test("declared flags render into chart values in a stable order, as on or off", () => {
  assert.deepEqual(
    featureHelmArgs({ features: { b: false, a: true } } as never),
    ["--set", "features.a=true", "--set", "features.b=false"],
  );
});

test("local charts receive flag values and upstream charts do not", async () => {
  const base = await loadRepository("local");
  const repository = {
    ...base,
    environment: {
      ...base.environment,
      features: { "autoscaling-defaults": true },
    },
  };
  const local = repository.catalog.components.find(
    (c) => c.kind === "local-chart",
  )!;
  const upstream = repository.catalog.components.find(
    (c) => c.kind === "helm",
  )!;
  assert.ok(
    helmTemplateArgs(repository, local)
      .join(" ")
      .includes("features.autoscaling-defaults=true"),
  );
  assert.ok(
    !helmTemplateArgs(repository, upstream).join(" ").includes("features."),
  );
});

test("app-delivery is listed false in every overlay, so no record is delivered until a recorded live outcome turns it on (ADR 0172)", async () => {
  for (const name of ["local", "vps", "managed-example"]) {
    const repository = await loadRepository(name);
    assert.equal(
      repository.environment.features?.["app-delivery"],
      false,
      `${name} overlay`,
    );
  }
});

test("golden-path-safety-defaults is listed false in every overlay, so no workload changes until a recorded live outcome turns it on (ADR 0154)", async () => {
  for (const name of ["local", "vps", "managed-example"]) {
    const repository = await loadRepository(name);
    assert.equal(
      repository.environment.features?.["golden-path-safety-defaults"],
      false,
      `${name} overlay`,
    );
  }
});

test("workload-defaults-admission is listed false in every overlay, so the admission constraint installs nothing until a recorded live outcome turns it on (issue 1526, ADR 0154)", async () => {
  for (const name of ["local", "vps", "managed-example"]) {
    const repository = await loadRepository(name);
    assert.equal(
      repository.environment.features?.["workload-defaults-admission"],
      false,
      `${name} overlay`,
    );
  }
});

test("the managed-example overlay validates with and without flags", async () => {
  const base = await loadRepository("managed-example");
  await validateRepository(base);
  await validateRepository({
    ...base,
    environment: {
      ...base.environment,
      features: {
        "agentgateway-mesh-enrollment": false,
        "autoscaling-defaults": false,
        "gateway-class-change-release": false,
        "gateway-rollback-order": false,
        "ingress-agentgateway": false,
        "external-dns": false,
        "otlp-route": false,
        "platform-argocd-delivery": false,
        "platform-dns": false,
        "platform-hostname-ownership": false,
        "platform-organization-service-apis": false,
        "platform-portal": false,
        "platform-shared-gateway": false,
        "workload-defaults-admission": false,
      },
    },
  });
});
