import assert from "node:assert/strict";
import { test } from "vitest";
import {
  crashLoop,
  type FakeEvent,
  liveCniFailure,
  liveSandboxOom,
  pod,
  reconcile,
  sandboxOom,
  Scenario,
  waiting,
} from "./fail-fast-fixtures.js";

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

async function failureMessage(scenario: Scenario): Promise<string> {
  try {
    await reconcile(scenario);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected the reconcile to fail");
}

const attempts = (tick: number, make: (n: number) => FakeEvent) =>
  Array.from({ length: Math.min(tick + 1, 15) }, (_, n) => make(n));

test("sandbox events with unique ids and count 1 are counted as distinct events", async () => {
  const scenario = new Scenario(() => [creating()], undefined, {
    events: (tick) => attempts(tick, liveSandboxOom),
  });
  const message = await failureMessage(scenario);
  assert.match(message, /FailedCreatePodSandBox \(x1[0-5]\)/);
});

test("a sandbox message keeps its meaningful tail and drops the unique ids", async () => {
  const scenario = new Scenario(() => [creating()], undefined, {
    events: (tick) => attempts(tick, liveSandboxOom),
  });
  const message = await failureMessage(scenario);
  assert.match(message, /container init was OOM-killed/);
  assert.doesNotMatch(message, /[0-9a-f]{64}/);
  assert.match(message, /<id>/);
  assert.doesNotMatch(message, /\s{2,}/);
});

test("a very long sandbox message keeps its head and tail around an ellipsis", async () => {
  const filler = "x".repeat(900);
  const scenario = new Scenario(() => [creating()], undefined, {
    events: () => [
      {
        reason: "FailedCreatePodSandBox",
        count: 5,
        message: `Failed to create pod sandbox: ${filler} container init was OOM-killed`,
      },
    ],
  });
  const message = await failureMessage(scenario);
  assert.match(message, /Failed to create pod sandbox/);
  assert.match(message, / … /);
  assert.match(message, /container init was OOM-killed/);
  assert.ok(message.length < 1000, "the quoted message is bounded");
});

test("the most recent sandbox message is quoted when the failure shape changes", async () => {
  const scenario = new Scenario(() => [creating()], undefined, {
    events: (tick) => [
      ...attempts(tick, liveSandboxOom),
      ...attempts(tick, liveCniFailure),
    ],
  });
  const message = await failureMessage(scenario);
  assert.match(message, /plugin type=\\"istio-cni\\"/);
  assert.doesNotMatch(message, /OOM-killed/);
  assert.match(message, /\(x(2[0-9]|30)\)/);
});
