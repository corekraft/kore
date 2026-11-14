import { expect, test } from "vitest";
import { orderedComponents } from "./order.js";
import { fakeCatalog, fakeComponent } from "./config-support.js";
import type { Component, Phase } from "./types.js";

function component(
  name: string,
  phase: Phase,
  dependencies: string[] = [],
): Component {
  return fakeComponent({ name, phase, dependencies });
}

test("components are released by phase, then by name within a phase", () => {
  const catalog = fakeCatalog([
    component("kore-ui", "core"),
    component("kore-boot", "bootstrap"),
    component("kore-a", "core"),
  ]);
  expect(orderedComponents(catalog).map((c) => c.name)).toEqual([
    "kore-boot",
    "kore-a",
    "kore-ui",
  ]);
});

test("a component waits for its dependency even when its own phase comes first", () => {
  const catalog = fakeCatalog([
    component("kore-early", "bootstrap", ["kore-late"]),
    component("kore-late", "enforcement"),
  ]);
  expect(orderedComponents(catalog).map((c) => c.name)).toEqual([
    "kore-late",
    "kore-early",
  ]);
});

test("a dependency cycle fails naming the components caught in it, sorted by name", () => {
  const catalog = fakeCatalog([
    component("kore-b", "core", ["kore-a"]),
    component("kore-a", "core", ["kore-b"]),
    component("kore-ok", "core"),
  ]);
  expect(() => orderedComponents(catalog)).toThrow(
    "release dependency cycle includes: kore-a, kore-b",
  );
});
