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

test("a group named in a component's ownsCRDs cannot also be provider-owned", async () => {
  const base = await loadRepository("local");
  const component = base.catalog.components.find(
    (c) => c.name === "gatekeeper",
  )!;

  await assert.rejects(
    validateRepository({
      ...base,
      catalog: {
        ...base.catalog,
        components: base.catalog.components.map((c) =>
          c === component
            ? { ...c, ownsCRDs: [...c.ownsCRDs, "things.k3s.cattle.io"] }
            : c,
        ),
      },
    }),
    /providerOwnedCRDGroups: k3s\.cattle\.io is also owned by gatekeeper/,
  );
});

test("a group claimed through ownsCRDGroups is refused as an overlap", async () => {
  const base = await loadRepository("local");

  await assert.rejects(
    validateRepository({
      ...base,
      catalog: {
        ...base.catalog,
        components: base.catalog.components.map((c) =>
          c.name === "gatekeeper"
            ? {
                ...c,
                ownsCRDGroups: [...(c.ownsCRDGroups ?? []), "helm.cattle.io"],
              }
            : c,
        ),
      },
    }),
    /providerOwnedCRDGroups: helm\.cattle\.io is also owned by gatekeeper/,
  );
});

test("a k3d overlay may only declare the groups k3s ships, and is told to claim any other in a component", async () => {
  const base = await loadRepository("local");

  await assert.rejects(
    validateRepository({
      ...base,
      environment: {
        ...base.environment,
        providerOwnedCRDGroups: {
          ...base.environment.providerOwnedCRDGroups,
          "monitoring.coreos.com": "widened",
        },
      },
    }),
    /providerOwnedCRDGroups: monitoring\.coreos\.com is not shipped by k3d; claim it in a catalog component with ownsCRDGroups instead/,
  );
});

test("a managed overlay declaring monitoring.coreos.com is refused", async () => {
  const base = await loadRepository("managed-example");

  await assert.rejects(
    validateRepository({
      ...base,
      environment: {
        ...base.environment,
        providerOwnedCRDGroups: { "monitoring.coreos.com": "operator-owned" },
      },
    }),
    /providerOwnedCRDGroups: monitoring\.coreos\.com is not shipped by managed; claim it in a catalog component with ownsCRDGroups instead/,
  );
});

test("providerOwnedCRDGroups must be a map of API group to reason", async () => {
  const base = await loadRepository("local");

  for (const bad of [["k3s.cattle.io"], 3, "k3s.cattle.io"]) {
    await assert.rejects(
      validateRepository({
        ...base,
        environment: {
          ...base.environment,
          providerOwnedCRDGroups: bad as never,
        },
      }),
      /environment\.providerOwnedCRDGroups must be a map of API group to reason/,
    );
  }
});
