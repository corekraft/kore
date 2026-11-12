import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, validateRepository } from "./config.js";

// Docs: docs/decisions/0088-provider-owned-crd-groups.md

test("the local k3d overlay declares the k3s CRD groups as provider-owned", async () => {
  const { environment } = await loadRepository("local");

  assert.deepEqual(
    Object.keys(environment.providerOwnedCRDGroups ?? {}).sort(),
    ["helm.cattle.io", "k3s.cattle.io"],
  );
});

test("an environment that declares no provider-owned groups stays valid", async () => {
  const base = await loadRepository("managed-example");

  assert.equal(base.environment.providerOwnedCRDGroups, undefined);
  await validateRepository(base);
});

test("a provider-owned group that is not an API group is rejected", async () => {
  const base = await loadRepository("local");

  await assert.rejects(
    validateRepository({
      ...base,
      environment: {
        ...base.environment,
        providerOwnedCRDGroups: { nogroup: "bad" },
      },
    }),
    /environment\.providerOwnedCRDGroups: nogroup must be an API group/,
  );
});

test("a provider-owned group must carry a reason", async () => {
  const base = await loadRepository("local");

  await assert.rejects(
    validateRepository({
      ...base,
      environment: {
        ...base.environment,
        providerOwnedCRDGroups: { "k3s.cattle.io": " " },
      },
    }),
    /environment\.providerOwnedCRDGroups: k3s\.cattle\.io needs a reason/,
  );
});

test("a group a catalog component owns cannot also be provider-owned", async () => {
  const base = await loadRepository("local");
  const gatekeeper = base.catalog.components.find(
    (c) => c.name === "gatekeeper",
  )!;
  const crd = gatekeeper.ownsCRDs[0]!;
  const group = crd.slice(crd.indexOf(".") + 1);

  await assert.rejects(
    validateRepository({
      ...base,
      environment: {
        ...base.environment,
        providerOwnedCRDGroups: { [group]: "overlap" },
      },
    }),
    new RegExp(
      `providerOwnedCRDGroups: ${group.replaceAll(".", "\\.")} is also owned by gatekeeper`,
    ),
  );
});
