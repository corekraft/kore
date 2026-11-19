import assert from "node:assert/strict";
import { test } from "vitest";
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
