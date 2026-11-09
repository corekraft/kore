import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, validateRepository } from "./config.js";
import type { ReadinessManifest, Repository } from "./types.js";

// Docs: docs/decisions/0067-platform-readiness-manifest-and-evidence.md

async function withReadiness(
  change: (manifest: ReadinessManifest) => ReadinessManifest,
): Promise<Repository> {
  const base = await loadRepository("local");
  return { ...base, readiness: change(base.readiness) };
}

test("the repository readiness manifest is versioned and covers every catalog component exactly once", async () => {
  const { readiness, catalog } = await loadRepository("local");
  assert.equal(readiness.version, 1);
  const covered = readiness.requirements.flatMap(
    (requirement) => requirement.components ?? [],
  );
  assert.deepEqual(
    [...covered].sort(),
    catalog.components.map((component) => component.name).sort(),
  );
});

test("the manifest names a step 7 to 11 capability and a prerequisite for every requirement", async () => {
  const { readiness } = await loadRepository("local");
  const capabilities = new Set(
    readiness.requirements.map((requirement) => requirement.capability),
  );
  for (const required of [
    "controller",
    "registry",
    "trust-policy",
    "shared-configuration",
    "platform-api",
    "endpoint",
    "health-condition",
  ]) {
    assert.ok(capabilities.has(required as never), `missing ${required}`);
  }
  for (const requirement of readiness.requirements) {
    assert.ok(requirement.step >= 7 && requirement.step <= 11);
    assert.ok(
      (requirement.components?.length ?? 0) +
        (requirement.platformChecks?.length ?? 0) >
        0,
      `${requirement.name} checks nothing`,
    );
  }
});

test("a catalog component the manifest does not require is rejected", async () => {
  const repository = await withReadiness((manifest) => ({
    ...manifest,
    requirements: manifest.requirements.map((requirement) => ({
      ...requirement,
      components: (requirement.components ?? []).filter(
        (name) => name !== "otel-agent",
      ),
    })),
  }));
  await assert.rejects(
    validateRepository(repository),
    /readiness manifest does not require component otel-agent/,
  );
});

test("a component required twice or unknown to the catalog is rejected", async () => {
  const twice = await withReadiness((manifest) => ({
    ...manifest,
    requirements: manifest.requirements.map((requirement, index) => ({
      ...requirement,
      components:
        index === 0
          ? [...(requirement.components ?? []), "otel-agent"]
          : (requirement.components ?? []),
    })),
  }));
  await assert.rejects(
    validateRepository(twice),
    /component otel-agent is required by more than one/,
  );
  const unknown = await withReadiness((manifest) => ({
    ...manifest,
    requirements: [
      ...manifest.requirements,
      {
        name: "ghost",
        step: 7,
        capability: "controller",
        components: ["no-such-component"],
      },
    ],
  }));
  await assert.rejects(
    validateRepository(unknown),
    /requirement ghost names unknown component no-such-component/,
  );
});

test("an unknown platform check, a duplicate name, an unsupported version and a bad step are rejected", async () => {
  const repository = await withReadiness((manifest) => ({
    version: 2 as 1,
    requirements: [
      ...manifest.requirements,
      {
        name: manifest.requirements[0]!.name,
        step: 3,
        capability: "controller",
        platformChecks: ["no-such-check"],
      },
    ],
  }));
  const errors = await validateRepository(repository).then(
    () => "",
    (error: Error) => error.message,
  );
  assert.match(errors, /version 2 is unsupported/);
  assert.match(errors, /unknown platform check no-such-check/);
  assert.match(errors, /duplicate requirement/);
  assert.match(errors, /step 3 must be between 7 and 11/);
});
