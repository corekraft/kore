import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import {
  crashLoop,
  pod,
  sandboxOom,
  Scenario,
  waiting,
} from "./fail-fast-fixtures.js";
import { reconcileComponent } from "./reconcile.js";

async function oci() {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(
    ({ name }) => name === "oci-registry",
  )!;
  return { repository, component };
}

async function reconcile(scenario: Scenario): Promise<void> {
  const { repository, component } = await oci();
  await reconcileComponent(repository, scenario, component, undefined, {
    clock: scenario.clock,
    intervalMs: 5000,
    graceMs: 60000,
  });
}

test("a crash-looping container is named with its previous logs and helm is cancelled", async () => {
  const scenario = new Scenario(() => [pod({ containers: [crashLoop(3)] })]);
  await assert.rejects(
    reconcile(scenario),
    (error: Error) =>
      /component oci-registry failed: pod oci-registry-x container registry CrashLoopBackOff \(3 restarts\)/.test(
        error.message,
      ) &&
      error.message.includes(
        "listen tcp :5001: bind: address already in use",
      ) &&
      /Check the container's ports and env/.test(error.message),
  );
  assert.equal(scenario.aborts, 1, "helm is cancelled exactly once");
  const logs = scenario.calls.find(({ args }) => args.includes("logs"))!;
  assert.ok(logs.args.includes("--previous"));
  assert.ok(logs.args.includes("oci-registry-x"));
  assert.equal(logs.args[logs.args.indexOf("--tail") + 1], "20");
  assert.equal(
    scenario.calls.some(({ args }) => args.includes("rollout")),
    false,
    "no readiness wait runs after the failure",
  );
});

test("a pod that cannot be scheduled for a minute is named with the scheduling message", async () => {
  const scenario = new Scenario(() => [
    pod({ nodeName: undefined, phase: "Pending" }),
  ]);
  await assert.rejects(
    reconcile(scenario),
    (error: Error) =>
      error.message.includes("component oci-registry failed") &&
      error.message.includes("pod oci-registry-x") &&
      error.message.includes("FailedScheduling") &&
      error.message.includes("didn't match pod anti-affinity rules"),
  );
  assert.ok(scenario.now >= 60000, "not fatal before the grace period");
  assert.equal(scenario.aborts, 1);
});

test("a FailedScheduling that clears is never fatal", async () => {
  const scenario = new Scenario(
    (tick) => [
      tick < 6
        ? pod({ nodeName: undefined, phase: "Pending" })
        : pod({ containers: [waiting("ContainerCreating")] }),
    ],
    20,
  );
  await reconcile(scenario);
  assert.equal(scenario.aborts, 0);
});

for (const reason of ["ImagePullBackOff", "ErrImagePull"]) {
  test(`${reason} that persists past the grace period is fatal`, async () => {
    const scenario = new Scenario(() => [
      pod({ containers: [waiting(reason, "pull access denied")] }),
    ]);
    await assert.rejects(
      reconcile(scenario),
      (error: Error) =>
        error.message.includes(reason) &&
        error.message.includes("pull access denied") &&
        error.message.includes("container registry"),
    );
    assert.ok(scenario.now >= 60000);
    assert.equal(scenario.aborts, 1);
  });
}

test("an image pull backoff that resolves within the grace period is ignored", async () => {
  const scenario = new Scenario(
    (tick) => [
      pod({
        containers: [tick < 4 ? waiting("ImagePullBackOff") : crashLoop(0)],
      }),
    ],
    8,
  );
  await reconcile(scenario);
  assert.equal(scenario.aborts, 0);
});

test("CreateContainerConfigError that persists is fatal", async () => {
  const scenario = new Scenario(() => [
    pod({
      containers: [
        waiting("CreateContainerConfigError", 'secret "x" not found'),
      ],
    }),
  ]);
  await assert.rejects(
    reconcile(scenario),
    /CreateContainerConfigError[\s\S]*secret "x" not found/,
  );
});

test("an init container that keeps failing is named as an init container", async () => {
  const scenario = new Scenario(() => [
    pod({ initContainers: [{ ...crashLoop(2), name: "migrate" }] }),
  ]);
  await assert.rejects(
    reconcile(scenario),
    /init container migrate CrashLoopBackOff \(2 restarts\)/,
  );
  const logs = scenario.calls.find(({ args }) => args.includes("logs"))!;
  assert.equal(logs.args[logs.args.indexOf("--container") + 1], "migrate");
});

test("a single restart is transient, not fatal", async () => {
  const scenario = new Scenario(
    () => [pod({ containers: [crashLoop(1)] })],
    10,
  );
  await reconcile(scenario);
  assert.equal(scenario.aborts, 0);
});

test("a healthy rollout is unaffected and the watch stops with it", async () => {
  const scenario = new Scenario(() => [pod({ containers: [] })], 0);
  await reconcile(scenario);
  assert.equal(scenario.aborts, 0);
  const before = scenario.calls.length;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scenario.calls.length, before, "no polling after completion");
});

test("pods of another release in the namespace are ignored", async () => {
  const scenario = new Scenario(
    () => [
      pod({
        name: "other-0",
        labels: { "app.kubernetes.io/instance": "other" },
        containers: [crashLoop(9)],
      }),
    ],
    10,
  );
  await reconcile(scenario);
  assert.equal(scenario.aborts, 0);
});

test("every watch call is read-only, names the context, and stays in the component namespace", async () => {
  const scenario = new Scenario(() => [pod({ containers: [crashLoop(3)] })]);
  await assert.rejects(reconcile(scenario));
  const { repository, component } = await oci();
  const kubectl = scenario.calls.filter(({ command }) => command === "kubectl");
  assert.ok(kubectl.length > 0);
  for (const { args } of kubectl) {
    assert.equal(
      args[args.indexOf("--context") + 1],
      repository.environment.kubeContext,
    );
    assert.equal(args[args.indexOf("--namespace") + 1], component.namespace);
    assert.ok(!args.includes("--all-namespaces") && !args.includes("-A"));
    assert.ok(
      ["get", "logs"].includes(args[args.indexOf("--namespace") + 2] ?? ""),
      `read-only verb in ${args.join(" ")}`,
    );
  }
});

const creating = (extra = {}) =>
  pod({
    nodeName: "node-1",
    phase: "Pending",
    containers: [waiting("ContainerCreating")],
    ...extra,
  });

test("a pod stuck in ContainerCreating with rising sandbox failures names the event reason and message", async () => {
  const scenario = new Scenario(() => [creating()], undefined, {
    events: (tick) => [sandboxOom(1 + tick)],
  });
  await assert.rejects(
    reconcile(scenario),
    (error: Error) =>
      error.message.startsWith(
        "component oci-registry failed: pod oci-registry-x is stuck in ContainerCreating: FailedCreatePodSandBox (x",
      ) &&
      error.message.includes("container init was OOM-killed") &&
      /resources\.limits, runtime class, CNI, or volume mounts/.test(
        error.message,
      ),
  );
  assert.ok(scenario.now >= 60000, "not fatal before the grace period");
  assert.equal(scenario.aborts, 1);
});

test("a single sandbox failure that clears is never fatal", async () => {
  const scenario = new Scenario(
    (tick) => [tick < 6 ? creating() : pod({ containers: [crashLoop(0)] })],
    20,
    { events: (tick) => (tick < 6 ? [sandboxOom(1)] : []) },
  );
  await reconcile(scenario);
  assert.equal(scenario.aborts, 0);
});

test("repeated sandbox failures that clear within the grace period are ignored", async () => {
  const scenario = new Scenario(
    (tick) => [tick < 6 ? creating() : pod({ containers: [crashLoop(0)] })],
    20,
    { events: (tick) => (tick < 6 ? [sandboxOom(5)] : []) },
  );
  await reconcile(scenario);
  assert.equal(scenario.aborts, 0);
});

test("a lone sandbox failure on a pod that stays in ContainerCreating becomes fatal after 90s", async () => {
  const scenario = new Scenario(() => [creating()], undefined, {
    events: () => [sandboxOom(1)],
  });
  await assert.rejects(reconcile(scenario), /stuck in ContainerCreating/);
  assert.ok(scenario.now >= 90000, "waits the longer stuck grace");
});

test("normal image pulling without a failure is not fatal", async () => {
  const scenario = new Scenario(() => [creating()], 30, {
    events: () => [{ reason: "Pulling", message: "Pulling image x", count: 9 }],
  });
  await reconcile(scenario);
  assert.equal(scenario.aborts, 0);
});

for (const reason of ["CreateContainerError", "RunContainerError"]) {
  test(`${reason} that persists is fatal and quotes its message`, async () => {
    const scenario = new Scenario(() => [
      pod({ containers: [waiting(reason, "exec: not found")] }),
    ]);
    await assert.rejects(
      reconcile(scenario),
      (error: Error) =>
        error.message.includes(reason) &&
        error.message.includes("exec: not found") &&
        error.message.includes("container registry"),
    );
    assert.ok(scenario.now >= 60000);
  });
}

test("when helm fails first, its error still carries what the watch last saw", async () => {
  const scenario = new Scenario(() => [creating()], undefined, {
    events: () => [sandboxOom(4)],
    helmFailsAtTick: 3,
  });
  await assert.rejects(
    reconcile(scenario),
    (error: Error) =>
      error.message.includes("context deadline exceeded") &&
      error.message.includes("ContainerCreating") &&
      error.message.includes("FailedCreatePodSandBox (x4)") &&
      error.message.includes("OOM-killed"),
  );
  assert.equal(scenario.aborts, 0, "the watch did not cancel helm");
});

test("when helm fails first and the watch saw nothing, helm's error is unchanged", async () => {
  const scenario = new Scenario(() => [pod({ containers: [] })], undefined, {
    helmFailsAtTick: 2,
  });
  await assert.rejects(
    reconcile(scenario),
    (error: Error) =>
      error.message.includes("context deadline exceeded") &&
      !error.message.includes("watch"),
  );
});
