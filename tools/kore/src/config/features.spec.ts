import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, validateRepository } from "./config.js";
import { featureEnabled, featureHelmArgs } from "./features.js";
import { helmTemplateArgs } from "../platform/helm.js";
import type { Repository } from "./types.js";

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
  assert.equal(featureEnabled(base.environment, "agent-loop"), false);
  assert.deepEqual(featureHelmArgs(base.environment), []);
});

test("a map of booleans validates and reads as on or off", async () => {
  assert.equal(await featuresMessage({ "agent-loop": true, quiet: false }), "");
  const environment = { features: { "agent-loop": true, quiet: false } };
  assert.equal(featureEnabled(environment as never, "agent-loop"), true);
  assert.equal(featureEnabled(environment as never, "quiet"), false);
  assert.equal(featureEnabled(environment as never, "absent"), false);
});

test("a non-boolean flag value is rejected naming the flag and the fix", async () => {
  const message = await featuresMessage({ "agent-loop": "true" });
  assert.match(
    message,
    /environment\.features\.agent-loop must be true or false/,
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
    await featuresMessage(["agent-loop"]),
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
    environment: { ...base.environment, features: { "agent-loop": true } },
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
      .includes("features.agent-loop=true"),
  );
  assert.ok(
    !helmTemplateArgs(repository, upstream).join(" ").includes("features."),
  );
});

test("the managed-example overlay validates with and without flags", async () => {
  const base = await loadRepository("managed-example");
  await validateRepository(base);
  await validateRepository({
    ...base,
    environment: {
      ...base.environment,
      features: { "agent-loop": false, "ingress-agentgateway": false },
    },
  });
});
