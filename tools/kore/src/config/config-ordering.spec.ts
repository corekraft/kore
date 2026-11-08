import assert from "node:assert/strict";
import { test } from "vitest";
import {
  findRoot,
  loadRepository,
  orderedComponents,
  type Catalog,
} from "./config.js";

test("repository catalogs and local environment validate", async () => {
  const root = await findRoot();
  const repository = await loadRepository("local", root);
  const order = orderedComponents(repository.catalog);
  assert.equal(order.length, repository.catalog.components.length);
  const positions = new Map(
    order.map((component, index) => [component.name, index]),
  );
  for (const component of order) {
    for (const dependency of component.dependencies) {
      assert.ok(positions.get(dependency)! < positions.get(component.name)!);
    }
  }
});

test("cycle detection reports every blocked component", () => {
  const catalog: Catalog = {
    components: [
      {
        name: "a",
        phase: "core",
        namespace: "a",
        kind: "helm",
        chart: "a",
        version: "local",
        ownsCRDs: [],
        dependencies: ["b"],
        timeout: "1m",
        readiness: [],
      },
      {
        name: "b",
        phase: "core",
        namespace: "b",
        kind: "helm",
        chart: "b",
        version: "local",
        ownsCRDs: [],
        dependencies: ["a"],
        timeout: "1m",
        readiness: [],
      },
    ],
  };
  assert.throws(() => orderedComponents(catalog), /a, b/);
});

test("release ordering places earlier infrastructure phases before later phases", () => {
  const catalog: Catalog = {
    components: [
      {
        name: "a-core-release",
        phase: "core",
        namespace: "core",
        kind: "helm",
        chart: "core",
        version: "local",
        ownsCRDs: [],
        dependencies: [],
        timeout: "1m",
        readiness: [],
      },
      {
        name: "z-bootstrap-release",
        phase: "bootstrap",
        namespace: "bootstrap",
        kind: "helm",
        chart: "bootstrap",
        version: "local",
        ownsCRDs: [],
        dependencies: [],
        timeout: "1m",
        readiness: [],
      },
    ],
  };

  assert.deepEqual(
    orderedComponents(catalog).map(({ name }) => name),
    ["z-bootstrap-release", "a-core-release"],
  );
});
