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
// Issue 1552, with the lane lead's decision: the suborg NetworkPolicies and grant policies
// have their own flag, which needs suborg-tenancy, so the namespace move stays activatable
// without the network part.

const flag = "suborg-network-policy";
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

test("suborg-network-policy is declared false in every overlay, so the network policies stay dark until a recorded live outcome", async () => {
  for (const name of overlays) {
    const repository = await loadRepository(name);
    assert.equal(repository.environment.features?.[flag], false, name);
    assert.equal(featureEnabled(repository.environment, flag), false, name);
  }
});

test("suborg-network-policy is a feature flag in the manifest that applies to every overlay", async () => {
  const { flags } = await loadRepository("local");
  assert.equal(flagEntry(flags, flag)?.kind, "feature");
  for (const name of overlays) {
    assert.ok(
      appliedFlags(flags, name).includes(flag),
      `${name} lists the flag`,
    );
  }
});

test("suborg-network-policy needs suborg-tenancy, and nothing else", async () => {
  const { flags } = await loadRepository("local");
  assert.deepEqual(requiredFlags(flags, flag), ["suborg-tenancy"]);
});

test("turning suborg-network-policy on without suborg-tenancy fails validation, naming it", async () => {
  const repository = await withFlags("vps", {
    [flag]: true,
    "suborg-tenancy": false,
  });
  await assert.rejects(validateRepository(repository), (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(
      message,
      /flag suborg-network-policy is on in the vps overlay but requires suborg-tenancy, which is off there/,
    );
    return true;
  });
});

test("turning suborg-network-policy on with suborg-tenancy on passes validation where the prerequisites are on", async () => {
  await validateRepository(
    await withFlags("local", { [flag]: true, "suborg-tenancy": true }),
  );
});

// managed-example records no cluster.serviceCidr. With both suborg flags on, the chart cannot
// render the policies without one, so validation refuses before any cluster is touched.
const managedFlags = {
  [flag]: true,
  "suborg-tenancy": true,
  "platform-organization-service-apis": true,
  "platform-argocd-delivery": true,
  "platform-portal": true,
};

test("with both suborg flags on, managed-example refuses validation for recording no cluster.serviceCidr, naming the field", async () => {
  const repository = await withFlags("managed-example", managedFlags);
  await assert.rejects(validateRepository(repository), (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(
      message,
      /suborg-tenancy and suborg-network-policy are on in the managed-example overlay but it records no cluster\.serviceCidr/,
    );
    return true;
  });
});

test("with both suborg flags on, a managed-example that records its service range passes the range check", async () => {
  const base = await withFlags("managed-example", managedFlags);
  const cluster = base.environment.cluster;
  assert.ok(cluster, "managed-example declares a cluster block");
  const repository = {
    ...base,
    environment: {
      ...base.environment,
      cluster: { ...cluster, serviceCidr: "10.43.0.0/16" },
    },
  };
  const message = await validateRepository(repository).then(
    () => "",
    (error: unknown) =>
      error instanceof Error ? error.message : String(error),
  );
  assert.doesNotMatch(message, /serviceCidr/);
});
