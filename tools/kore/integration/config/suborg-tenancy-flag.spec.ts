import assert from "node:assert/strict";
import { test } from "vitest";
import {
  appliedFlags,
  featureEnabled,
  flagEntry,
  loadRepository,
  requiredFlags,
  validateRepository,
} from "../../src/config/index.js";
import type { Repository } from "../../src/config/index.js";

// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md

const flag = "suborg-tenancy";
const overlays = ["local", "vps", "managed-example"];

/** The repository of an environment with suborg-tenancy set as given; every other flag is the overlay's own. */
async function withSuborgTenancy(
  name: string,
  on: boolean,
): Promise<Repository> {
  const base = await loadRepository(name);
  return {
    ...base,
    environment: {
      ...base.environment,
      features: { ...base.environment.features, [flag]: on },
    },
  };
}

test("suborg-tenancy is declared false in every overlay, so the namespace move stays dark until a recorded live outcome", async () => {
  for (const name of overlays) {
    const repository = await loadRepository(name);
    assert.equal(repository.environment.features?.[flag], false, name);
    assert.equal(featureEnabled(repository.environment, flag), false, name);
  }
});

test("suborg-tenancy is a feature flag in the manifest that applies to every overlay", async () => {
  const { flags } = await loadRepository("local");
  assert.equal(flagEntry(flags, flag)?.kind, "feature");
  for (const name of overlays) {
    assert.ok(
      appliedFlags(flags, name).includes(flag),
      `${name} lists the flag`,
    );
  }
});

test("suborg-tenancy needs the Organization API and the records Application, which together make the Organization the namespace owner (ADR 0166)", async () => {
  const { flags } = await loadRepository("local");
  assert.deepEqual(requiredFlags(flags, flag), [
    "platform-organization-service-apis",
    "platform-argocd-delivery",
    "platform-portal",
  ]);
});

test("turning suborg-tenancy on without the flags it needs fails validation, naming each one", async () => {
  const repository = await withSuborgTenancy("vps", true);
  await assert.rejects(validateRepository(repository), (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, /suborg-tenancy/);
    assert.match(message, /platform-organization-service-apis/);
    return true;
  });
});

test("turning suborg-tenancy on where its prerequisites are on passes validation", async () => {
  await validateRepository(await withSuborgTenancy("local", true));
});
