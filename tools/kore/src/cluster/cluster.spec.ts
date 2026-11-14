import {
  loadManagedLocal,
  fast,
  k3dRepository,
  list,
  ok,
  testHome,
} from "../testing/index.js";
import assert from "node:assert/strict";
import { expect, test } from "vitest";
import {
  assertExpectedCluster,
  clusterDestroy,
  clusterUp,
  clusterStatus,
  clusterStop,
} from "./cluster.js";
import { CommandError, RecordingRunner } from "../runtime/index.js";

test("managed cluster status uses kubectl and reports its context", async () => {
  const base = await loadManagedLocal();
  const repository = {
    ...base,
    environment: { ...base.environment, kubeContext: "production-east" },
  };
  const runner = new RecordingRunner([
    { stdout: "Kubernetes control plane is running", stderr: "", code: 0 },
  ]);

  assert.deepEqual(await clusterStatus(repository, runner), {
    environment: "local",
    profile: "kore-local",
    context: "production-east",
    status: "Kubernetes control plane is running",
  });
  assert.deepEqual(runner.calls[0]?.args, [
    "--context",
    "production-east",
    "cluster-info",
  ]);
});

test("expected-cluster validation checks the configured managed context directly", async () => {
  const base = await loadManagedLocal();
  const repository = {
    ...base,
    environment: { ...base.environment, kubeContext: "managed-eu" },
  };
  const runner = new RecordingRunner([
    { stdout: "namespace/kube-system", stderr: "", code: 0 },
  ]);
  await assertExpectedCluster(repository, runner);
  assert.deepEqual(runner.calls[0]?.args, [
    "--context",
    "managed-eu",
    "get",
    "namespace",
    "kube-system",
    "-o",
    "name",
  ]);
});

test("cluster lifecycle refuses a managed environment and runs no command", async () => {
  const managed = await loadManagedLocal();
  const runner = new RecordingRunner();
  await assert.rejects(
    clusterUp(managed, runner),
    /only manages k3d environments; provision managed clusters with OpenTofu/,
  );
  await assert.rejects(
    clusterStop(managed, runner),
    /only available for k3d environments/,
  );
  await assert.rejects(
    clusterDestroy(managed, runner, { yes: true, purgeData: true }),
    /only available for k3d environments/,
  );
  assert.deepEqual(runner.calls, []);
});

/** A k3d runner whose /readyz and node-Ready answers the spec scripts. */
function scriptedRunner(
  calls: string[],
  answer: (args: readonly string[]) => string | CommandError | undefined,
) {
  return {
    async run(command: string, args: readonly string[]) {
      calls.push(`${command} ${args.join(" ")}`);
      if (command === "k3d" && args[1] === "list") {
        return ok(list(1));
      }
      const reply = answer(args);
      if (reply instanceof Error) {
        throw reply;
      }
      return ok(reply ?? "kube-system");
    },
  };
}

test("cluster up waits for the API server and node before returning", async () => {
  const repository = await k3dRepository();
  const calls: string[] = [];
  let readyz = 0;
  const runner = scriptedRunner(calls, (args) => {
    if (args.includes("--raw")) {
      return ++readyz < 3
        ? new CommandError("kubectl", args, {
            stdout: "",
            stderr: "connection refused",
            code: 1,
          })
        : "ok";
    }
    return args.some((arg) => arg.startsWith("jsonpath={range"))
      ? "k3d-kore-local-server-0=True\n"
      : undefined;
  });
  await clusterUp(repository, runner, fast, testHome);
  const raw = calls.filter((c) => c.includes("get --raw /readyz"));
  expect(raw).toHaveLength(3);
  expect(raw[0]).toContain("--context k3d-kore-local");
  const nodes = calls.findIndex((c) => c.includes("jsonpath={range"));
  const assertNs = calls.findIndex((c) => c.includes("jsonpath={.metadata"));
  expect(nodes).toBeGreaterThan(calls.lastIndexOf(raw[2] as string));
  expect(assertNs).toBeGreaterThan(nodes);
});

test("cluster up times out naming the node that is not Ready", async () => {
  const repository = await k3dRepository();
  let now = 0;
  const runner = scriptedRunner([], (args) =>
    args.some((arg) => arg.startsWith("jsonpath={range"))
      ? "k3d-kore-local-server-0=False\n"
      : "ok",
  );
  await expect(
    clusterUp(
      repository,
      runner,
      {
        timeoutMs: 10_000,
        now: () => now,
        sleep: async (ms) => void (now += ms),
      },
      testHome,
    ),
  ).rejects.toThrow(/node k3d-kore-local-server-0 is not Ready/);
});
