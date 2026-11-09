import assert from "node:assert/strict";
import { test } from "vitest";
import {
  crashLoop,
  oci,
  reconcile,
  pod,
  Scenario,
  waiting,
} from "./fail-fast-fixtures.js";

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
