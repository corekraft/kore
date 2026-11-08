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

test("an unreadable seed component values file fails instead of hiding its images", async () => {
  const base = await loadRepository("local");
  const repository: Repository = {
    ...base,
    catalog: {
      ...base.catalog,
      components: base.catalog.components.map((component) =>
        component.name === "policy-controller"
          ? {
              ...component,
              values: [...(component.values ?? []), "infra/catalog"],
            }
          : component,
      ),
    },
  };
  await assert.rejects(validateRepository(repository), /EISDIR|infra\/catalog/);
});

test("every seed records machine-readable upstream provenance: an exact signer or explicit unsigned", async () => {
  const { seeds } = await loadRepository("local");
  const byImage = Object.fromEntries(
    seeds.seeds.map((seed) => [seed.catalogImage, seed.evidence.provenance]),
  );
  assert.deepEqual(byImage["oci-registry"], { signed: false });
  assert.deepEqual(byImage["policy-controller"], {
    signed: true,
    issuer: "https://token.actions.githubusercontent.com",
    identity:
      "https://github.com/sigstore/policy-controller/.github/workflows/release.yaml@refs/tags/v0.13.1",
  });
  assert.deepEqual(byImage["policy-controller-kubectl"], {
    signed: true,
    issuer: "https://token.actions.githubusercontent.com",
    identity:
      "https://github.com/chainguard-images/images/.github/workflows/release.yaml@refs/heads/main",
  });
});

test("a seed without provenance is rejected so the mirror cannot guess", async () => {
  const repository = await withSeeds((seeds) =>
    seeds.map((seed, i) =>
      i === 0
        ? {
            ...seed,
            evidence: { ...seed.evidence, provenance: undefined as never },
          }
        : seed,
    ),
  );
  await assert.rejects(
    validateRepository(repository),
    /evidence\.provenance is required/,
  );
});

test("a signed seed must name an https issuer and an exact identity, never a pattern", async () => {
  const signed = (identity: string, issuer = "https://issuer.example") => ({
    signed: true as const,
    issuer,
    identity,
  });
  for (const provenance of [
    signed("https://github.com/sigstore/.*"),
    signed("https://github.com/a/b/*"),
    signed("not-a-url"),
    signed("https://github.com/a/b.yaml@refs/tags/v1", "issuer"),
  ]) {
    const repository = await withSeeds((seeds) =>
      seeds.map((seed, i) =>
        i === 0
          ? { ...seed, evidence: { ...seed.evidence, provenance } }
          : seed,
      ),
    );
    await assert.rejects(
      validateRepository(repository),
      /provenance/,
      JSON.stringify(provenance),
    );
  }
});
