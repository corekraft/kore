import assert from "node:assert/strict";
import { test } from "vitest";
import {
  committedFraction,
  loadRepository,
  nodeBudget,
  nodeCount,
  validateRepository,
} from "../../src/config/index.js";

// Docs: docs/decisions/0152-one-node-capacity-is-a-declared-budget-that-quotas-enforce-and-memory-favours-the-cluster.md

const overlays = ["local", "managed-example", "vps"] as const;

for (const overlay of overlays) {
  test(`the ${overlay} overlay validates unchanged and reads one node and a committed fraction of 0.8 by default`, async () => {
    const repository = await loadRepository(overlay);
    await validateRepository(repository);
    assert.equal(nodeCount(repository.environment), 1);
    assert.equal(committedFraction(repository.environment), 0.8);
  });
}

test("the vps overlay declares a node count of one and no reserve or disk value, so its budget is not judged", async () => {
  const { environment } = await loadRepository("vps");
  assert.equal(environment.nodeCount, 1);
  assert.equal(environment.cluster?.kubelet, undefined);
  assert.equal(environment.cluster?.diskReserve, undefined);
  assert.equal(nodeBudget(environment).judged, false);
});

test("an overlay whose node count is below one is refused by validation, naming the field and how to fix it", async () => {
  const repository = await loadRepository("vps");
  const invalid = {
    ...repository,
    environment: { ...repository.environment, nodeCount: 0 },
  };
  await assert.rejects(
    validateRepository(invalid),
    /environment\.nodeCount must be a whole number of at least 1/,
  );
});

test("an overlay whose committed fraction is outside zero to one is refused by validation, naming the field", async () => {
  const repository = await loadRepository("vps");
  const invalid = {
    ...repository,
    environment: { ...repository.environment, committedFraction: 1.5 },
  };
  await assert.rejects(
    validateRepository(invalid),
    /environment\.committedFraction must be a number from 0 to 1/,
  );
});
