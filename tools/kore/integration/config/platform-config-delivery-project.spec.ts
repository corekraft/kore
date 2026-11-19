import assert from "node:assert/strict";
import { test } from "vitest";
import {
  argocdOwned,
  composed,
  renderDelivery,
  withFlags,
} from "./platform-config-delivery-project-support.js";
import {
  namespacedKinds,
  renderedResources,
  type Resource,
} from "./platform-config-delivery-resources-support.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (the AppProject admits only what the handed-over releases render)

/** The lines of one top-level field of the rendered AppProject spec, up to the next field. */
function section(project: string, field: string, next: string): string {
  const start = project.indexOf(`\n  ${field}:`);
  const end = project.indexOf(`\n  ${next}:`, start);
  assert.ok(start >= 0 && end > start, `${field} sits before ${next}`);
  return project.slice(start, end);
}

const group = (resource: Pick<Resource, "group" | "kind">) =>
  `${resource.group}/${resource.kind}`;

/** What the AppProject lets an Application in it apply, read from its own whitelist and destinations. */
function admitted(project: string) {
  const whitelist = section(project, "clusterResourceWhitelist", "roles");
  const destinations = section(
    project,
    "destinations",
    "clusterResourceWhitelist",
  );
  return {
    whitelist,
    clusterKinds: [...whitelist.matchAll(/- group: (.*)\n\s+kind: (\S+)/g)].map(
      (m) => `${m[1]!.replaceAll('"', "")}/${m[2]!}`,
    ),
    destinations: [...destinations.matchAll(/ namespace: "(.+)"/g)].map(
      (m) => m[1]!,
    ),
  };
}

const appProject = (docs: string[]) =>
  docs.find((d) => /^kind: AppProject$/m.test(d))!;

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
