import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, type Repository } from "../../src/config/index.js";
import {
  admitted,
  appProject,
  argocdOwned,
  composed,
  renderDelivery,
  withFlags,
} from "../platform-config-delivery-project-support.js";
import {
  namespacedKinds,
  renderedResources,
  type Resource,
} from "../platform-config-delivery-resources-support.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (the AppProject admits only what the handed-over releases render)

const group = (resource: Pick<Resource, "group" | "kind">) =>
  `${resource.group}/${resource.kind}`;

for (const on of [true, false]) {
  test(`the AppProject admits every cluster-scoped kind and namespace the argocd-owned components render with every flag ${on ? "on" : "off"}`, async () => {
    const repository = await composed(await withFlags(on));
    const { docs } = await renderDelivery(await withFlags(on));
    const { whitelist, clusterKinds, destinations } = admitted(
      appProject(docs),
    );
    assert.doesNotMatch(whitelist, /kind: "?\*"?/);
    assert.doesNotMatch(whitelist, /group: "?\*"?/);
    const unadmitted: string[] = [];
    for (const name of argocdOwned(repository)) {
      const component = repository.catalog.components.find(
        (c) => c.name === name,
      )!;
      const resources = await renderedResources(repository, name);
      assert.ok(resources.length > 0, `${name} renders something`);
      for (const resource of resources) {
        if (!namespacedKinds.has(group(resource))) {
          if (!clusterKinds.includes(group(resource))) {
            unadmitted.push(
              `${name}: ${group(resource)} is not in clusterResourceWhitelist`,
            );
          }
          continue;
        }
        const space = resource.namespace ?? component.namespace;
        if (!destinations.includes(space)) {
          unadmitted.push(
            `${name}: ${group(resource)} in namespace ${space} is not a destination`,
          );
        }
      }
    }
    assert.deepEqual(unadmitted, []);
  }, 120_000);
}

test("with every flag on, the hostname-ownership constraint kind is an argocd-owned render the AppProject admits", async () => {
  const repository = await composed(await withFlags(true));
  const resources = await renderedResources(
    repository,
    "kore-hostname-ownership",
  );
  assert.deepEqual(resources.map(group), [
    "constraints.gatekeeper.sh/KoreHostnameOwnership",
  ]);
  const { docs } = await renderDelivery(await withFlags(true));
  assert.ok(
    admitted(appProject(docs)).clusterKinds.includes(
      "constraints.gatekeeper.sh/KoreHostnameOwnership",
    ),
  );
}, 120_000);

test("the AppProject whitelists exactly the cluster-scoped kinds the argocd-owned components render with every flag on, with no wildcard", async () => {
  const repository = await composed(await withFlags(true));
  const { docs } = await renderDelivery(await withFlags(true));
  const rendered = new Set<string>();
  for (const name of argocdOwned(repository)) {
    for (const resource of await renderedResources(repository, name)) {
      if (!namespacedKinds.has(group(resource))) {
        rendered.add(group(resource));
      }
    }
  }
  assert.deepEqual(
    [...admitted(appProject(docs)).clusterKinds].sort(),
    [...rendered].sort(),
  );
}, 120_000);

/** The local repository with platform-sync-window set as given; every other flag is the overlay's own. */
async function withSyncWindow(on: boolean): Promise<Repository> {
  const base = await loadRepository("local");
  return {
    ...base,
    environment: {
      ...base.environment,
      features: { ...base.environment.features, "platform-sync-window": on },
    },
  };
}

test("with platform-sync-window on and a maintenance hold, the AppProject denies every sync in it, manual ones too, and changes nothing else", async () => {
  const off = appProject(
    (await renderDelivery(await withSyncWindow(false))).docs,
  );
  const held = appProject(
    (
      await renderDelivery(await withSyncWindow(true), [
        "--set",
        "maintenanceHold=true",
      ])
    ).docs,
  );
  assert.equal(
    held,
    `${off.trimEnd()}
  syncWindows:
    - kind: deny
      schedule: "* * * * *"
      duration: 24h
      applications:
        - "*"
      manualSync: true
`,
  );
}, 120_000);

test("with platform-sync-window on and no maintenance hold, the AppProject is the one the flag-off render gives", async () => {
  const off = appProject(
    (await renderDelivery(await withSyncWindow(false))).docs,
  );
  const on = appProject(
    (await renderDelivery(await withSyncWindow(true))).docs,
  );
  assert.equal(on, off);
}, 120_000);

test("a maintenance hold with platform-sync-window off renders no sync window, so the flag gates the deny window", async () => {
  const off = appProject(
    (await renderDelivery(await withSyncWindow(false))).docs,
  );
  const held = appProject(
    (
      await renderDelivery(await withSyncWindow(false), [
        "--set",
        "maintenanceHold=true",
      ])
    ).docs,
  );
  assert.equal(held, off);
}, 120_000);

test("the AppProject admits the CA's ClusterIssuer kind and the cert-manager namespace only with in-cluster-ca on", async () => {
  for (const on of [true, false]) {
    const repository = await withFlags(true);
    const flagged: typeof repository = {
      ...repository,
      environment: {
        ...repository.environment,
        features: { ...repository.environment.features, "in-cluster-ca": on },
      },
    };
    const { docs } = await renderDelivery(flagged);
    const { clusterKinds, destinations } = admitted(appProject(docs));
    assert.equal(clusterKinds.includes("cert-manager.io/ClusterIssuer"), on);
    assert.equal(destinations.includes("cert-manager"), on);
  }
}, 120_000);
