import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../../src/config/index.js";
import type { Runner } from "../../src/runtime/index.js";
import { reconcileComponent } from "../../src/platform/index.js";

type Call = { command: string; args: readonly string[] };

function fakeCluster(): { runner: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

async function helmComponent(readiness: string[]) {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(
    ({ kind }) => kind === "helm",
  )!;
  return {
    repository,
    component: { ...component, readiness, ownsCRDs: [], timeout: "1s" },
  };
}

test("a ClusterImagePolicy is ready once Policy Controller reports it Ready, not by a rollout", async () => {
  const { repository, component } = await helmComponent([
    "clusterimagepolicy.policy.sigstore.dev/kore-platform-images",
  ]);
  const { runner, calls } = fakeCluster();

  await reconcileComponent(repository, runner, component);

  const waits = calls
    .filter(({ command }) => command === "kubectl")
    .map(({ args }) => args.join(" "))
    .filter((call) => call.includes(" wait "));
  assert.equal(waits.length, 1);
  assert.match(
    waits[0]!,
    /wait --for=condition=Ready clusterimagepolicy\.policy\.sigstore\.dev\/kore-platform-images --timeout=1s/,
  );
  assert.ok(
    calls.every(({ args }) => !args.includes("rollout")),
    "a ClusterImagePolicy is not a workload with a rollout",
  );
});

test("the image policy component waits on its ClusterImagePolicy by fully qualified kind", async () => {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(
    ({ name }) => name === "kore-image-policy",
  )!;
  assert.deepEqual(component.readiness, [
    "clusterimagepolicy.policy.sigstore.dev/kore-platform-images",
    "clusterimagepolicy.policy.sigstore.dev/kore-upstream-images",
  ]);
});
