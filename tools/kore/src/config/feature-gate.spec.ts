import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, validateRepository } from "./config.js";
import { enabledComponents } from "./features.js";
import type { Repository } from "./types.js";

async function gatedRepository(
  features: Record<string, boolean> | undefined,
  flag = "agent-ingress",
): Promise<Repository> {
  const base = await loadRepository("local");
  const [first, ...rest] = base.catalog.components;
  return {
    ...base,
    catalog: {
      ...base.catalog,
      components: [{ ...first!, featureFlag: flag }, ...rest],
    },
    environment: { ...base.environment, ...(features ? { features } : {}) },
  };
}

test("a gated component whose flag the environment declares validates", async () => {
  await validateRepository(await gatedRepository({ "agent-ingress": false }));
});

test("a gated component names itself and the flag when the environment does not declare it", async () => {
  const repository = await gatedRepository({ other: true });
  const name = repository.catalog.components[0]!.name;
  await assert.rejects(
    validateRepository(repository),
    new RegExp(
      `${name}: featureFlag agent-ingress is not declared in environment.features`,
    ),
  );
});

test("a gated component fails validation when the environment has no features map", async () => {
  await assert.rejects(
    validateRepository(await gatedRepository(undefined)),
    /featureFlag agent-ingress is not declared/,
  );
});

test("a malformed featureFlag is rejected", async () => {
  await assert.rejects(
    validateRepository(await gatedRepository({ Bad_Flag: true }, "Bad_Flag")),
    /featureFlag Bad_Flag must be lowercase/,
  );
});

test("a flag that is off leaves the component out of the enabled set; on keeps it in order", async () => {
  const off = await gatedRepository({ "agent-ingress": false });
  const name = off.catalog.components[0]!.name;
  assert.ok(!enabledComponents(off).some((c) => c.name === name));
  const on = await gatedRepository({ "agent-ingress": true });
  assert.ok(enabledComponents(on).some((c) => c.name === name));
});

test("components without a flag are all enabled", async () => {
  const base = await loadRepository("local");
  assert.equal(enabledComponents(base).length, base.catalog.components.length);
});
