// Docs: infra/plans/14-test-tiers.md#step-2-pilots
import { expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { withScheduledPods } from "./readiness-daemonset.js";

type Run = Runner["run"];
type Rollout = { run: (timeout: string) => Promise<void> };

const BASE = ["--context", "k3d-kore-local", "--namespace", "istio-system"];
const RESOURCE = "daemonset/ztunnel";

/** A typed runner whose kubectl reply is the DaemonSet status JSON, or the given stdout. */
function fakeRunner(stdout: string) {
  const run = vi.fn<Run>(async () => ({ stdout, stderr: "", code: 0 }));
  return { runner: { run } as Runner, run };
}

function fakeRollout(): Rollout & { run: ReturnType<typeof vi.fn> } {
  return { run: vi.fn(async (_timeout: string) => undefined) };
}

/** A DaemonSet status with every count set; overrides replace single fields. */
function status(overrides: Record<string, number> = {}): string {
  return JSON.stringify({
    desiredNumberScheduled: 3,
    numberReady: 3,
    numberUnavailable: 0,
    updatedNumberScheduled: 3,
    ...overrides,
  });
}

test("the DaemonSet condition states that the rollout is complete and every desired pod is scheduled and ready", () => {
  const { runner } = fakeRunner(status());

  const wait = withScheduledPods(
    { runner, base: BASE },
    RESOURCE,
    fakeRollout(),
  );

  expect(wait.condition).toBe(
    "rollout complete and every desired pod scheduled and ready",
  );
});

test("the wait runs the rollout at the given bound, then reads the status with the base arguments", async () => {
  const { runner, run } = fakeRunner(status());
  const rollout = fakeRollout();
  const wait = withScheduledPods({ runner, base: BASE }, RESOURCE, rollout);

  await wait.run("3s");

  expect(rollout.run).toHaveBeenCalledWith("3s");
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [...BASE, "get", RESOURCE, "--output", "jsonpath={.status}"],
    { capture: true },
  );
});

test("a DaemonSet with every desired pod scheduled, ready, available and on the current revision passes", async () => {
  const { runner } = fakeRunner(status());
  const wait = withScheduledPods(
    { runner, base: BASE },
    RESOURCE,
    fakeRollout(),
  );

  await expect(wait.run("3s")).resolves.toBeUndefined();
});

test("a DaemonSet that schedules no pods fails, even though its rollout reports complete", async () => {
  const { runner } = fakeRunner(
    status({
      desiredNumberScheduled: 0,
      numberReady: 0,
      updatedNumberScheduled: 0,
    }),
  );
  const wait = withScheduledPods(
    { runner, base: BASE },
    RESOURCE,
    fakeRollout(),
  );

  await expect(wait.run("3s")).rejects.toThrow(
    "daemonset/ztunnel desiredNumberScheduled is 0: no pods are scheduled (no node matches its nodeSelector or tolerations, or it is down)",
  );
});

test("a DaemonSet with no desiredNumberScheduled at all is read as scheduling no pods", async () => {
  const { runner } = fakeRunner(JSON.stringify({ numberReady: 0 }));
  const wait = withScheduledPods(
    { runner, base: BASE },
    RESOURCE,
    fakeRollout(),
  );

  await expect(wait.run("3s")).rejects.toThrow(
    "desiredNumberScheduled is 0: no pods are scheduled",
  );
});

test("a DaemonSet with fewer ready pods than desired fails with the count", async () => {
  const { runner } = fakeRunner(status({ numberReady: 2 }));
  const wait = withScheduledPods(
    { runner, base: BASE },
    RESOURCE,
    fakeRollout(),
  );

  await expect(wait.run("3s")).rejects.toThrow(
    "daemonset/ztunnel numberReady 2 of 3 desired",
  );
});

test("a DaemonSet with an unavailable pod fails even when every pod is ready", async () => {
  const { runner } = fakeRunner(status({ numberUnavailable: 1 }));
  const wait = withScheduledPods(
    { runner, base: BASE },
    RESOURCE,
    fakeRollout(),
  );

  await expect(wait.run("3s")).rejects.toThrow(
    "daemonset/ztunnel numberUnavailable is 1",
  );
});

test("a DaemonSet whose pods are not all on the current revision fails with the updated count", async () => {
  const { runner } = fakeRunner(status({ updatedNumberScheduled: 1 }));
  const wait = withScheduledPods(
    { runner, base: BASE },
    RESOURCE,
    fakeRollout(),
  );

  await expect(wait.run("3s")).rejects.toThrow(
    "daemonset/ztunnel updatedNumberScheduled 1 of 3 desired",
  );
});

test("a status that is not JSON fails naming the resource, not with a parse error", async () => {
  const { runner } = fakeRunner("<html>not json</html>");
  const wait = withScheduledPods(
    { runner, base: BASE },
    RESOURCE,
    fakeRollout(),
  );

  await expect(wait.run("3s")).rejects.toThrow(
    "daemonset/ztunnel status is not readable JSON",
  );
});

test("a rollout that fails stops the wait before the DaemonSet status is read", async () => {
  const { runner, run } = fakeRunner(status());
  const rollout = fakeRollout();
  rollout.run.mockRejectedValue(new Error("timed out waiting for the rollout"));
  const wait = withScheduledPods({ runner, base: BASE }, RESOURCE, rollout);

  await expect(wait.run("3s")).rejects.toThrow("timed out waiting");

  expect(run).not.toHaveBeenCalled();
});
