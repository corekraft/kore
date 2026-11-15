import assert from "node:assert/strict";
import { test } from "node:test";
import { PlatformReadError } from "./kube.js";
import { createProvider } from "./provider.js";

const objects = {
  organizations: [{ metadata: { name: "platform" } }],
  services: [],
};

test("a refresh replaces the provider's entities in full, each with a location key", async () => {
  const mutations = [];
  const provider = createProvider({
    list: async () => objects,
    log: { warn() {} },
  });
  await provider.connect({ applyMutation: async (m) => mutations.push(m) });
  await provider.refresh();
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].type, "full");
  assert.deepEqual(
    mutations[0].entities.map((e) => e.entity.metadata.name),
    ["platform-operators", "platform"],
  );
  assert.ok(
    mutations[0].entities.every(
      (e) => e.locationKey === "kore-platform-provider",
    ),
  );
});

test("a failed read keeps the existing catalog: nothing is applied", async () => {
  const mutations = [];
  const warnings = [];
  const provider = createProvider({
    list: async () => {
      throw new PlatformReadError("forbidden");
    },
    log: { warn: (m) => warnings.push(m) },
  });
  await provider.connect({ applyMutation: async (m) => mutations.push(m) });
  await provider.refresh();
  assert.deepEqual(mutations, []);
  assert.equal(warnings.length, 1);
});

test("refreshing before the catalog connects is an error", async () => {
  const provider = createProvider({
    list: async () => objects,
    log: { warn() {} },
  });
  await assert.rejects(() => provider.refresh(), /not connected/);
});

test("an unexpected error is rethrown, not swallowed as a read failure", async () => {
  const warnings = [];
  const provider = createProvider({
    list: async () => {
      throw new TypeError("bug");
    },
    log: { warn: (m) => warnings.push(m) },
  });
  await provider.connect({ applyMutation: async () => {} });
  await assert.rejects(() => provider.refresh(), /bug/);
  assert.deepEqual(warnings, []);
});
