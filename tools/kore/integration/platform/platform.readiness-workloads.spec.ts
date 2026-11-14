import { loadRepository } from "../../src/config/index.js";
import assert from "node:assert/strict";
import { test } from "vitest";

import type { Runner } from "../../src/runtime/index.js";
import { reconcileComponent } from "../../src/platform/index.js";

type Handler = (args: readonly string[]) => string;
interface Call {
  command: string;
  args: readonly string[];
}

function fakeCluster(handler: Handler): { runner: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      return {
        stdout: command === "kubectl" ? handler(args) : "",
        stderr: "",
        code: 0,
      };
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

test("a ConfigMap readiness entry is proven by existence, not by a rollout", async () => {
  const { repository, component } = await helmComponent([
    "configmap/kore-prometheus-rules",
  ]);
  const { runner, calls } = fakeCluster(
    () => "configmap/kore-prometheus-rules",
  );

  await reconcileComponent(repository, runner, component);

  const kubectl = calls.filter(({ command }) => command === "kubectl");
  assert.ok(
    kubectl.some(
      ({ args }) =>
        args.includes("get") &&
        args.includes("configmap/kore-prometheus-rules"),
    ),
  );
  assert.ok(kubectl.every(({ args }) => !args.includes("rollout")));
});

test("a Crossplane Function is ready only after it is Installed and then Healthy", async () => {
  const { repository, component } = await helmComponent([
    "function.pkg.crossplane.io/function-auto-ready",
  ]);
  const { runner, calls } = fakeCluster(() => "");

  await reconcileComponent(repository, runner, component);

  const waits = calls
    .filter(({ command }) => command === "kubectl")
    .map(({ args }) => args.join(" "))
    .filter((call) => call.includes(" wait "));
  assert.equal(waits.length, 2);
  assert.match(
    waits[0]!,
    /wait --for=condition=Installed function\.pkg\.crossplane\.io\/function-auto-ready --timeout=1s/,
  );
  assert.match(
    waits[1]!,
    /wait --for=condition=Healthy function\.pkg\.crossplane\.io\/function-auto-ready --timeout=1s/,
  );
  assert.ok(
    calls.every(({ args }) => !args.includes("rollout")),
    "a Function is not a workload with a rollout",
  );
});

test("a Function that never becomes Healthy fails naming the Function and condition", async () => {
  const { repository, component } = await helmComponent([
    "function.pkg.crossplane.io/function-go-templating",
  ]);
  const { runner } = {
    runner: {
      async run(command: string, args: readonly string[]) {
        if (args.includes("--for=condition=Healthy")) {
          throw new Error("timed out waiting for the condition on functions");
        }
        return { stdout: "", stderr: "", code: 0 };
      },
    } as Runner,
  };

  await assert.rejects(
    reconcileComponent(repository, runner, component),
    /function\.pkg\.crossplane\.io\/function-go-templating not ready \(Installed and Healthy\) within 1s: .*timed out/s,
  );
});

test("a Function that is not yet created is retried until it appears", async () => {
  const { repository, component } = await helmComponent([
    "function.pkg.crossplane.io/function-auto-ready",
  ]);
  let installedWaits = 0;
  const runner: Runner = {
    async run(_command, args) {
      if (args.includes("--for=condition=Installed")) {
        installedWaits++;
        if (installedWaits === 1) {
          throw new Error('functions.pkg.crossplane.io "x" not found');
        }
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await reconcileComponent(repository, runner, component);
  assert.equal(installedWaits, 2);
});
