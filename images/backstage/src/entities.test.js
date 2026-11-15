import assert from "node:assert/strict";
import { test } from "node:test";
import { entitiesFor } from "./entities.js";

const org = { metadata: { name: "platform" }, spec: {} };
const svc = (name, organization = "platform") => ({
  metadata: { name },
  spec: { organization, environments: ["local"] },
});

function names(entities) {
  return entities.map((e) => `${e.kind}:${e.metadata.name}`);
}

test("an Organization becomes a System and the operators Group exists once", () => {
  const entities = entitiesFor({ organizations: [org], services: [] });
  assert.deepEqual(names(entities), [
    "Group:platform-operators",
    "System:platform",
  ]);
});

test("a Service becomes a Component of its Organization's System, linked to its workload and Argo CD Application", () => {
  const [, , component] = entitiesFor({
    organizations: [org],
    services: [svc("shop")],
  });
  assert.deepEqual(component, {
    apiVersion: "backstage.io/v1alpha1",
    kind: "Component",
    metadata: {
      name: "shop",
      annotations: {
        "backstage.io/kubernetes-label-selector":
          "app.kubernetes.io/part-of=shop",
        "argocd/app-selector": "platform.kore.dev/service=shop",
      },
    },
    spec: {
      type: "service",
      lifecycle: "production",
      owner: "group:default/platform-operators",
      system: "platform",
    },
  });
});

test("an object whose name Backstage would reject is skipped, not fatal", () => {
  const entities = entitiesFor({
    organizations: [{ metadata: { name: "Bad Name" } }, org],
    services: [svc("x".repeat(64)), svc("ok")],
  });
  assert.deepEqual(names(entities), [
    "Group:platform-operators",
    "System:platform",
    "Component:ok",
  ]);
});

test("a Service naming no listed Organization is not given a System", () => {
  const [, , component] = entitiesFor({
    organizations: [org],
    services: [svc("orphan", "other")],
  });
  assert.equal(component.spec.system, undefined);
});
