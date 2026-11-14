import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../../src/config/index.js";
import type { Runner } from "../../src/runtime/index.js";
import {
  reconcileComponent,
  readinessFailure,
} from "../../src/platform/index.js";

interface DaemonSetStatus {
  desiredNumberScheduled: number;
  numberReady: number;
  numberUnavailable?: number;
  updatedNumberScheduled: number;
}

const healthy: DaemonSetStatus = {
  desiredNumberScheduled: 2,
  numberReady: 2,
  updatedNumberScheduled: 2,
};

/** `kubectl rollout status` passes in every case, as it does for zero pods. */
function cluster(status: DaemonSetStatus) {
  const calls: string[][] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push([command, ...args]);
      const isGet = command === "kubectl" && args.includes("get");
      return {
        stdout: isGet ? JSON.stringify(status) : "",
        stderr: "",
        code: 0,
      };
    },
  };
  return { runner, calls };
}

async function subject() {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(
    ({ kind }) => kind === "helm",
  )!;
  return {
    repository,
    component: {
      ...component,
      readiness: ["daemonset/agent"],
      ownsCRDs: [],
      timeout: "1s",
    },
  };
}

test("a DaemonSet with no scheduled pods is not ready though rollout status passes", async () => {
  const { repository, component } = await subject();
  const { runner } = cluster({
    desiredNumberScheduled: 0,
    numberReady: 0,
    updatedNumberScheduled: 0,
  });

  await assert.rejects(
    reconcileComponent(repository, runner, component),
    /daemonset\/agent not ready .*desiredNumberScheduled is 0.*no pods are scheduled/s,
  );
  const failure = await readinessFailure(repository, runner, component);
  assert.match(failure ?? "", /desiredNumberScheduled is 0/);
});

test("a partially ready DaemonSet is not ready and names the counts", async () => {
  const { repository, component } = await subject();
  const { runner } = cluster({ ...healthy, numberReady: 1 });

  const failure = await readinessFailure(repository, runner, component);
  assert.match(failure ?? "", /daemonset\/agent .*numberReady 1 of 2/);
});

test("a DaemonSet with unavailable pods is not ready and names them", async () => {
  const { repository, component } = await subject();
  const { runner } = cluster({ ...healthy, numberUnavailable: 1 });

  const failure = await readinessFailure(repository, runner, component);
  assert.match(failure ?? "", /daemonset\/agent .*numberUnavailable is 1/);
});

test("a DaemonSet with pods on an old revision is not ready and names the counts", async () => {
  const { repository, component } = await subject();
  const { runner } = cluster({ ...healthy, updatedNumberScheduled: 1 });

  const failure = await readinessFailure(repository, runner, component);
  assert.match(
    failure ?? "",
    /daemonset\/agent .*updatedNumberScheduled 1 of 2/,
  );
});

test("a fully ready DaemonSet is ready and a rerun stays read-only", async () => {
  const { repository, component } = await subject();
  const { runner, calls } = cluster(healthy);

  assert.equal(
    await readinessFailure(repository, runner, component),
    undefined,
  );
  assert.equal(
    await readinessFailure(repository, runner, component),
    undefined,
  );
  assert.ok(
    calls.every(
      ([, ...args]) => args.includes("get") || args.includes("rollout"),
    ),
    "readiness only reads",
  );
});

test("the status read uses a kubectl output format, never a template function", async () => {
  const { repository, component } = await subject();
  const { runner, calls } = cluster(healthy);

  await readinessFailure(repository, runner, component);
  const get = calls.find(([, ...args]) => args.includes("get"))!;
  const output = get.slice(get.indexOf("get"));
  assert.deepEqual(output.slice(-3), [
    "daemonset/agent",
    "--output",
    "jsonpath={.status}",
  ]);
  assert.ok(
    !get.some((arg) => arg.includes("{{") || arg.startsWith("go-template")),
    "kubectl go-templates have no json function",
  );
});
