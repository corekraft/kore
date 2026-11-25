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

// Docs: docs/decisions/0167-application-secrets-come-from-openbao-behind-the-platform-secrets-contract-one-path-per-suborg.md
// Issue 1555: each suborg gets its own External Secrets ClusterSecretStore, limited by namespace
// condition to its own namespace. It has its own flag, which needs suborg-tenancy (the suborg
// namespace the store serves), so the flag stays dark until a recorded live outcome (#1559).

const flag = "suborg-secret-store";
const overlays = ["local", "vps", "managed-example"];

/** The repository of an overlay with the given flags set; every other flag is the overlay's own. */
async function withFlags(
  name: string,
  set: Record<string, boolean>,
): Promise<Repository> {
  const base = await loadRepository(name);
  return {
    ...base,
    environment: {
      ...base.environment,
      features: { ...base.environment.features, ...set },
    },
  };
}

test("suborg-secret-store is declared false in every overlay, so the per-suborg stores stay dark until a recorded live outcome", async () => {
  for (const name of overlays) {
    const repository = await loadRepository(name);
    assert.equal(repository.environment.features?.[flag], false, name);
    assert.equal(featureEnabled(repository.environment, flag), false, name);
  }
});

test("suborg-secret-store is a feature flag in the manifest that applies to every overlay", async () => {
  const { flags } = await loadRepository("local");
  assert.equal(flagEntry(flags, flag)?.kind, "feature");
  for (const name of overlays) {
    assert.ok(
      appliedFlags(flags, name).includes(flag),
      `${name} lists the flag`,
    );
  }
});

test("suborg-secret-store needs suborg-tenancy, and nothing else", async () => {
  const { flags } = await loadRepository("local");
  assert.deepEqual(requiredFlags(flags, flag), ["suborg-tenancy"]);
});

test("turning suborg-secret-store on without suborg-tenancy fails validation, naming both flags and the fix", async () => {
  const repository = await withFlags("vps", {
    [flag]: true,
    "suborg-tenancy": false,
  });
  await assert.rejects(validateRepository(repository), (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(
      message,
      /flag suborg-secret-store is on in the vps overlay but requires suborg-tenancy, which is off there; set "suborg-tenancy": true in the vps overlay, or turn suborg-secret-store off/,
    );
    return true;
  });
});

test("turning suborg-secret-store on with suborg-tenancy on passes validation in local", async () => {
  await validateRepository(
    await withFlags("local", {
      [flag]: true,
      "suborg-tenancy": true,
    }),
  );
});
