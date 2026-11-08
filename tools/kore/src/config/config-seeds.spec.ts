import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, validateRepository } from "./config.js";
import type { Repository, Seed } from "./types.js";

async function withSeeds(
  change: (seeds: Seed[]) => Seed[],
): Promise<Repository> {
  const base = await loadRepository("local");
  return { ...base, seeds: { seeds: change(base.seeds.seeds) } };
}

test("the repository seed manifest records the registry and verifier images, each with reason and evidence", async () => {
  const { seeds } = await loadRepository("local");
  assert.deepEqual(seeds.seeds.map((seed) => seed.catalogImage).sort(), [
    "oci-registry",
    "policy-controller",
    "policy-controller-kubectl",
  ]);
  for (const seed of seeds.seeds) {
    assert.match(seed.image, /@sha256:[0-9a-f]{64}$/);
    assert.ok(seed.reason.length > 0);
    assert.match(seed.evidence.checked, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("a seed without a digest is rejected", async () => {
  const repository = await withSeeds((seeds) =>
    seeds.map((seed, i) =>
      i === 0 ? { ...seed, image: "registry:3.1.2" } : seed,
    ),
  );
  await assert.rejects(
    validateRepository(repository),
    /seed registry:3\.1\.2.*digest/i,
  );
});

test("a seed without a reason or upstream evidence is rejected", async () => {
  const repository = await withSeeds((seeds) =>
    seeds.map((seed, i) =>
      i === 0
        ? {
            ...seed,
            reason: "",
            evidence: { ...seed.evidence, source: "", checked: "yesterday" },
          }
        : seed,
    ),
  );
  await assert.rejects(validateRepository(repository), (error: Error) => {
    assert.match(error.message, /reason is required/);
    assert.match(error.message, /evidence\.source is required/);
    assert.match(error.message, /evidence\.checked must be a YYYY-MM-DD date/);
    return true;
  });
});

test("a seed naming an unknown component is rejected", async () => {
  const repository = await withSeeds((seeds) =>
    seeds.map((seed, i) => (i === 0 ? { ...seed, component: "nope" } : seed)),
  );
  await assert.rejects(
    validateRepository(repository),
    /unknown component nope/,
  );
});

test("a seed that differs from the catalog image is rejected", async () => {
  const repository = await withSeeds((seeds) =>
    seeds.map((seed, i) =>
      i === 0
        ? { ...seed, image: `registry:9.9.9@sha256:${"a".repeat(64)}` }
        : seed,
    ),
  );
  await assert.rejects(
    validateRepository(repository),
    /does not match versions\.images\.oci-registry/,
  );
});

test("an image used by a seed component but not recorded as a seed is rejected", async () => {
  const repository = await withSeeds((seeds) =>
    seeds.filter((seed) => seed.catalogImage !== "policy-controller-kubectl"),
  );
  await assert.rejects(
    validateRepository(repository),
    /unrecorded seed artifact policy-controller-kubectl.*policy-controller/,
  );
});

test("a seed must be used by its component", async () => {
  const repository = await withSeeds((seeds) =>
    seeds.map((seed, i) =>
      i === 0 ? { ...seed, component: "policy-controller" } : seed,
    ),
  );
  await assert.rejects(
    validateRepository(repository),
    /not used by policy-controller/,
  );
});

test("duplicate seeds are rejected", async () => {
  const repository = await withSeeds((seeds) => [...seeds, seeds[0]!]);
  await assert.rejects(validateRepository(repository), /duplicate seed/);
});
