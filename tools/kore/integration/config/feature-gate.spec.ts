import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, validateRepository } from "../../src/config/config.js";
import { enabledComponents } from "../../src/config/features.js";
import type { Repository } from "../../src/config/types.js";

/** The local repository without the catalog's own gated components. */
async function ungatedRepository(): Promise<Repository> {
  const base = await loadRepository("local");
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

/** Gates a leaf component: nothing in the catalog depends on it. */
async function gatedRepository(
  features: Record<string, boolean> | undefined,
  flag = "agent-ingress",
): Promise<Repository> {
  const base = await ungatedRepository();
  const needed = new Set(
    base.catalog.components.flatMap((c) => c.dependencies),
  );
  const leaf = base.catalog.components.find((c) => !needed.has(c.name))!;
  return {
    ...base,
    catalog: {
      ...base.catalog,
      components: [
        { ...leaf, featureFlag: flag },
        ...base.catalog.components.filter((c) => c !== leaf),
      ],
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
  const base = await ungatedRepository();
  assert.equal(enabledComponents(base).length, base.catalog.components.length);
});

test("an enabled component may not depend on a component its flag gates off", async () => {
  const repository = await gatedRepository({ "agent-ingress": false });
  const gated = repository.catalog.components[0]!;
  const dependent = repository.catalog.components[1]!;
  repository.catalog.components[1] = {
    ...dependent,
    dependencies: [...dependent.dependencies, gated.name],
  };
  await assert.rejects(
    validateRepository(repository),
    new RegExp(
      `${dependent.name}: depends on ${gated.name}, which feature agent-ingress gates off`,
    ),
  );
});

test("a gated component may depend on another gated component with the same flag", async () => {
  const repository = await gatedRepository({ "agent-ingress": false });
  const [first, ...rest] = repository.catalog.components;
  const needed = new Set(rest.flatMap((c) => c.dependencies));
  const byName = new Map(rest.map((c) => [c.name, c]));
  const ancestors = new Set<string>();
  const visit = (name: string): void => {
    if (!ancestors.has(name)) {
      ancestors.add(name);
      byName.get(name)?.dependencies.forEach(visit);
    }
  };
  first!.dependencies.forEach(visit);
  const second = rest.find(
    (c) => !needed.has(c.name) && !ancestors.has(c.name),
  )!;
  repository.catalog.components = repository.catalog.components.map((c) =>
    c === second
      ? {
          ...c,
          featureFlag: "agent-ingress",
          dependencies: [...c.dependencies, first!.name],
        }
      : c,
  );
  await validateRepository(repository);
});

test("a manifest component cannot be gated, and the error says so and how to proceed", async () => {
  const repository = await gatedRepository({ "agent-ingress": false });
  const manifest = repository.catalog.components.find(
    (c) => c.kind === "manifest",
  )!;
  repository.catalog.components = repository.catalog.components.map((c) =>
    c === manifest ? { ...c, featureFlag: "agent-ingress" } : c,
  );
  await assert.rejects(
    validateRepository(repository),
    new RegExp(
      `${manifest.name}: featureFlag is not supported on a manifest component; gate a helm or local-chart component instead`,
    ),
  );
});
