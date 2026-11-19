import assert from "node:assert/strict";
import { test } from "vitest";
import {
  argocdOwned,
  composed,
  namespacedKinds,
  renderDelivery,
  renderedResources,
  withFlags,
  type Resource,
} from "./platform-config-delivery-chart-support.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (the AppProject admits only what the handed-over releases render)

/** What the AppProject lets an Application in it apply, read from the rendered AppProject. */
function admitted(project: string) {
  const whitelist = project.slice(project.indexOf("clusterResourceWhitelist:"));
  const clusterKinds = [
    ...whitelist.matchAll(/- group: (.*)\n\s+kind: (\S+)/g),
  ].map((m) => `${m[1]!.replaceAll('"', "")}/${m[2]!}`);
  const destinations = [...project.matchAll(/ namespace: "(.+)"/g)].map(
    (m) => m[1]!,
  );
  return { clusterKinds, destinations };
}

for (const on of [true, false]) {
  test(`the AppProject admits every cluster-scoped kind and namespace the argocd-owned components render with every flag ${on ? "on" : "off"}`, async () => {
    const repository = await composed(await withFlags(on));
    const { docs } = await renderDelivery(await withFlags(on));
    const project = docs.find((d) => /^kind: AppProject$/m.test(d))!;
    const { clusterKinds, destinations } = admitted(project);
    assert.doesNotMatch(project, /kind: "?\*"?/);
    const unadmitted: string[] = [];
    for (const name of argocdOwned(repository)) {
      const component = repository.catalog.components.find(
        (c) => c.name === name,
      )!;
      const resources: Resource[] = await renderedResources(repository, name);
      assert.ok(resources.length > 0, `${name} renders something`);
      for (const { group, kind, namespace } of resources) {
        if (
          !namespacedKinds.has(kind) &&
          !clusterKinds.includes(`${group}/${kind}`)
        ) {
          unadmitted.push(
            `${name}: ${group}/${kind} is not in clusterResourceWhitelist`,
          );
        }
        const space = namespace ?? component.namespace;
        if (namespacedKinds.has(kind) && !destinations.includes(space)) {
          unadmitted.push(
            `${name}: ${kind} in namespace ${space} is not a destination`,
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
  assert.deepEqual(
    resources.map((r) => `${r.group}/${r.kind}`),
    ["constraints.gatekeeper.sh/KoreHostnameOwnership"],
  );
  const { docs } = await renderDelivery(await withFlags(true));
  const project = docs.find((d) => /^kind: AppProject$/m.test(d))!;
  assert.ok(
    admitted(project).clusterKinds.includes(
      "constraints.gatekeeper.sh/KoreHostnameOwnership",
    ),
  );
}, 120_000);

test("the AppProject whitelists exactly the cluster-scoped kinds the argocd-owned components render with every flag on, with no wildcard", async () => {
  const repository = await composed(await withFlags(true));
  const { docs } = await renderDelivery(await withFlags(true));
  const project = docs.find((d) => /^kind: AppProject$/m.test(d))!;
  const rendered = new Set<string>();
  for (const name of argocdOwned(repository)) {
    for (const { group, kind } of await renderedResources(repository, name)) {
      if (!namespacedKinds.has(kind)) {
        rendered.add(`${group}/${kind}`);
      }
    }
  }
  assert.deepEqual(
    [...admitted(project).clusterKinds].sort(),
    [...rendered].sort(),
  );
}, 120_000);
