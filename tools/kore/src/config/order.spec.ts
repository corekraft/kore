import { expect, test } from "vitest";
import { orderedComponents } from "./order.js";
import type { Catalog, Component } from "./types.js";

function component(
  name: string,
  phase: string,
  dependencies: string[] = [],
): Component {
  return { name, phase, dependencies } as unknown as Component;
}

const catalogOf = (...components: Component[]): Catalog =>
  ({ components }) as unknown as Catalog;

test("components are released by phase, then by name within a phase", () => {
  const catalog = catalogOf(
    component("kore-ui", "core"),
    component("kore-boot", "bootstrap"),
    component("kore-a", "core"),
  );
  expect(orderedComponents(catalog).map((c) => c.name)).toEqual([
    "kore-boot",
    "kore-a",
    "kore-ui",
  ]);
});

test("a component waits for its dependency even when its own phase comes first", () => {
  const catalog = catalogOf(
    component("kore-early", "bootstrap", ["kore-late"]),
    component("kore-late", "enforcement"),
  );
  expect(orderedComponents(catalog).map((c) => c.name)).toEqual([
    "kore-late",
    "kore-early",
  ]);
});

test("a dependency cycle fails naming the components caught in it, sorted by name", () => {
  const catalog = catalogOf(
    component("kore-b", "core", ["kore-a"]),
    component("kore-a", "core", ["kore-b"]),
    component("kore-ok", "core"),
  );
  expect(() => orderedComponents(catalog)).toThrow(
    "release dependency cycle includes: kore-a, kore-b",
  );
});
