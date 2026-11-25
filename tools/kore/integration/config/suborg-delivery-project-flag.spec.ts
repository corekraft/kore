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
// Issue 1553: each suborg gets an Argo CD AppProject that deploys only into its own namespace.
// It has its own flag, which needs suborg-tenancy and platform-argocd-delivery (the Argo CD
// delivery the project lives in), so the flag stays dark until a recorded live outcome.

const flag = "suborg-delivery-project";
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

test("suborg-delivery-project is declared false in every overlay, so the suborg AppProjects stay dark until a recorded live outcome", async () => {
  for (const name of overlays) {
    const repository = await loadRepository(name);
    assert.equal(repository.environment.features?.[flag], false, name);
    assert.equal(featureEnabled(repository.environment, flag), false, name);
  }
});

test("suborg-delivery-project is a feature flag in the manifest that applies to every overlay", async () => {
  const { flags } = await loadRepository("local");
  assert.equal(flagEntry(flags, flag)?.kind, "feature");
  for (const name of overlays) {
    assert.ok(
      appliedFlags(flags, name).includes(flag),
      `${name} lists the flag`,
    );
  }
});

test("suborg-delivery-project needs suborg-tenancy and platform-argocd-delivery, and nothing else", async () => {
  const { flags } = await loadRepository("local");
  assert.deepEqual(requiredFlags(flags, flag), [
    "suborg-tenancy",
    "platform-argocd-delivery",
  ]);
});

test("turning suborg-delivery-project on without suborg-tenancy fails validation, naming it", async () => {
  const repository = await withFlags("vps", {
    [flag]: true,
    "suborg-tenancy": false,
  });
  await assert.rejects(validateRepository(repository), (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(
      message,
      /flag suborg-delivery-project is on in the vps overlay but requires suborg-tenancy, which is off there/,
    );
    return true;
  });
});

test("turning suborg-delivery-project on without platform-argocd-delivery fails validation, naming it", async () => {
  const repository = await withFlags("vps", {
    [flag]: true,
    "suborg-tenancy": true,
    "platform-argocd-delivery": false,
  });
  await assert.rejects(validateRepository(repository), (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(
      message,
      /flag suborg-delivery-project is on in the vps overlay but requires platform-argocd-delivery, which is off there/,
    );
    return true;
  });
});

test("turning suborg-delivery-project on with its prerequisites on passes validation in local", async () => {
  await validateRepository(
    await withFlags("local", {
      [flag]: true,
      "suborg-tenancy": true,
      "platform-argocd-delivery": true,
    }),
  );
});
