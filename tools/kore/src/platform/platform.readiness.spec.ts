import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { RecordingRunner } from "../runtime/runner.js";
import { bootstrapControllers } from "./bootstrap.js";
import { reconcileComponent } from "./reconcile.js";

async function helmComponent(readiness: string[], timeout = "1s") {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(
    ({ kind }) => kind === "helm",
  )!;
  return {
    repository,
    component: { ...component, readiness, ownsCRDs: [], timeout },
  };
}

test("readiness waits use the condition that matches each resource kind", async () => {
  const { repository, component } = await helmComponent([
    "certificate/edge-tls",
    "deployment/web",
  ]);
  const runner = new RecordingRunner();

  await reconcileComponent(repository, runner, component);

  const waits = runner.calls
    .filter(({ command }) => command === "kubectl")
    .map(({ args }) => args.join(" "))
    .filter((call) => /\b(wait|rollout)\b/.test(call));
  assert.equal(waits.length, 2);
  assert.match(waits[0]!, /wait --for=condition=Ready certificate\/edge-tls/);
  assert.match(waits[1]!, /rollout status deployment\/web --timeout=1s/);
  assert.ok(waits.every((call) => call.includes(`--namespace`)));
});

test("a TLS Secret that never completes fails with the readiness timeout", async () => {
  const { repository, component } = await helmComponent(["secret/edge-tls"]);
  const runner = new RecordingRunner();

  await assert.rejects(
    reconcileComponent(repository, runner, component),
    /component .* failed to become ready: secret\/edge-tls not ready \(complete TLS Secret\) within 1s/,
  );
});

test("a CRD wait failure that is not a missing resource is not retried", async () => {
  const { repository, component } = await helmComponent([
    "crd/widgets.example",
  ]);
  let waits = 0;
  const runner: Runner = {
    async run(command, args) {
      if (command === "kubectl" && args.includes("wait")) {
        waits++;
        throw new Error("forbidden: cannot get customresourcedefinitions");
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await assert.rejects(
    reconcileComponent(repository, runner, component),
    /forbidden/,
  );
  assert.equal(waits, 1);
});

test("managed environments verify their cluster instead of starting Minikube", async () => {
  const base = await loadRepository("managed-example");
  const repository = { ...base, catalog: { components: [] } };
  const runner = new RecordingRunner();

  await bootstrapControllers(repository, runner);

  assert.equal(runner.calls.length, 1);
  assert.equal(runner.calls[0]?.command, "kubectl");
  assert.ok(runner.calls[0]?.args.includes(repository.environment.kubeContext));
});
