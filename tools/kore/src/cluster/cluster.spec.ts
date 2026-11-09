import assert from "node:assert/strict";
import { expect, test } from "vitest";
import {
  assertExpectedCluster,
  clusterDestroy,
  clusterStartArgs,
  clusterUp,
  clusterStatus,
  clusterStop,
} from "./cluster.js";
import { loadRepository } from "../config/index.js";
import { CommandError, RecordingRunner } from "../runtime/runner.js";

test("cluster start command pins profile, context inputs, runtime, and resources", async () => {
  const repository = await loadRepository("local");
  const args = clusterStartArgs(repository.environment);
  assert.deepEqual(args, [
    "start",
    "--profile",
    "kore-local",
    "--kubernetes-version",
    "v1.37.2",
    "--driver",
    "docker",
    "--container-runtime",
    "containerd",
    "--cpus",
    "4",
    "--memory",
    "8192",
    "--disk-size",
    "40g",
    "--apiserver-names",
    "kore-local",
    "--service-cluster-ip-range",
    "10.96.0.0/12",
    "--keep-context=false",
  ]);
});

test("cluster start omits the service range when none is declared", async () => {
  const { environment } = await loadRepository("local");
  const { serviceCidr: _drop, ...cluster } = environment.cluster;
  assert.equal(
    clusterStartArgs({ ...environment, cluster }).includes(
      "--service-cluster-ip-range",
    ),
    false,
  );
});

test("destroy requires explicit confirmation", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([
    { stdout: "{}", stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
    { stdout: "", stderr: "", code: 0 },
    { stdout: "", stderr: "", code: 0 },
  ]);
  await assert.rejects(
    clusterDestroy(repository, runner, { yes: false, purgeData: false }),
    /requires --yes/,
  );
  assert.equal(
    runner.calls.some((call) => call.args.includes("delete")),
    false,
  );
});

test("cluster stop uses flags supported by Minikube", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([
    { stdout: "{}", stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
  ]);

  await clusterStop(repository, runner);

  assert.equal(runner.calls.at(-1)?.command, "minikube");
  assert.deepEqual(runner.calls.at(-1)?.args, [
    "stop",
    "--profile",
    "kore-local",
  ]);
});

test("managed cluster status uses kubectl and reports its context", async () => {
  const base = await loadRepository("local");
  const repository = {
    ...base,
    environment: {
      ...base.environment,
      provider: "managed" as const,
      kubeContext: "production-east",
    },
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
  const base = await loadRepository("local");
  const repository = {
    ...base,
    environment: {
      ...base.environment,
      provider: "managed" as const,
      kubeContext: "managed-eu",
    },
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

test("expected-cluster checks reject mismatched contexts and unavailable profiles", async () => {
  const base = await loadRepository("local");
  const mismatched = {
    ...base,
    environment: { ...base.environment, kubeContext: "other-context" },
  };
  await assert.rejects(
    assertExpectedCluster(mismatched, new RecordingRunner()),
    /refusing unexpected profile\/context pair/,
  );

  const unavailable = {
    async run() {
      throw new Error("profile is stopped");
    },
  };
  await assert.rejects(
    assertExpectedCluster(base, unavailable),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "ClusterUnavailableError" &&
      error.message.includes("kore-local") &&
      error.cause instanceof Error &&
      error.cause.message === "profile is stopped",
  );
});

test("cluster up starts the configured profile then validates its context", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([
    { stdout: "", stderr: "", code: 0 },
    { stdout: "ok", stderr: "", code: 0 },
    { stdout: "kore-local=True\n", stderr: "", code: 0 },
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
  ]);

  await clusterUp(repository, runner);

  assert.deepEqual(
    runner.calls[0]?.args,
    clusterStartArgs(repository.environment),
  );
  assert.equal(runner.calls[0]?.options?.capture, false);
  assert.equal(runner.calls[0]?.options?.cwd, repository.root);
  assert.equal(runner.calls.at(-1)?.args.at(-1), "jsonpath={.metadata.name}");
});

test("cluster lifecycle rejects unmanaged providers and mismatched start profiles", async () => {
  const base = await loadRepository("local");
  const managed = {
    ...base,
    environment: { ...base.environment, provider: "managed" as const },
  };
  await assert.rejects(
    clusterUp(managed, new RecordingRunner()),
    /only manages Minikube/,
  );
  await assert.rejects(
    clusterStop(managed, new RecordingRunner()),
    /only available for Minikube/,
  );
  await assert.rejects(
    clusterDestroy(managed, new RecordingRunner(), {
      yes: true,
      purgeData: true,
    }),
    /only available for Minikube/,
  );
  const mismatched = {
    ...base,
    environment: { ...base.environment, kubeContext: "different-context" },
  };
  await assert.rejects(
    clusterUp(mismatched, new RecordingRunner()),
    /profile and expected context must match/,
  );
});

test("expected-cluster validation rejects a context pointing at another cluster", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "default", stderr: "", code: 0 },
  ]);
  await assert.rejects(
    assertExpectedCluster(repository, runner),
    /did not identify the expected cluster/,
  );
});

test("cluster up waits for the API server and node before returning", async () => {
  const repository = await loadRepository("local");
  const calls: string[] = [];
  let readyz = 0;
  const runner = {
    async run(command: string, args: readonly string[]) {
      calls.push(`${command} ${args.join(" ")}`);
      if (args.includes("--raw")) {
        if (++readyz < 3) {
          throw new CommandError(command, args, {
            stdout: "",
            stderr: "connection refused",
            code: 1,
          });
        }
        return { stdout: "ok", stderr: "", code: 0 };
      }
      if (args.some((arg) => arg.startsWith("jsonpath={range"))) {
        return { stdout: "kore-local=True\n", stderr: "", code: 0 };
      }
      return { stdout: "kube-system", stderr: "", code: 0 };
    },
  };
  await clusterUp(repository, runner, { sleep: async () => undefined });
  const start = calls.findIndex((c) => c.startsWith("minikube start"));
  const raw = calls.filter((c) => c.includes("get --raw /readyz"));
  expect(raw).toHaveLength(3);
  expect(raw[0]).toContain("--context kore-local");
  expect(calls.findIndex((c) => c.includes("--raw"))).toBeGreaterThan(start);
  const nodes = calls.findIndex((c) => c.includes("jsonpath={range"));
  const assertNs = calls.findIndex((c) => c.includes("jsonpath={.metadata"));
  expect(nodes).toBeGreaterThan(calls.lastIndexOf(raw[2] as string));
  expect(assertNs).toBeGreaterThan(nodes);
});

test("cluster up times out naming the API server when readyz never passes", async () => {
  const repository = await loadRepository("local");
  let now = 0;
  const runner = {
    async run(command: string, args: readonly string[]) {
      if (command === "kubectl") {
        throw new CommandError(command, args, {
          stdout: "",
          stderr: "connection refused",
          code: 1,
        });
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  await expect(
    clusterUp(repository, runner, {
      timeoutMs: 10_000,
      now: () => now,
      sleep: async (ms) => void (now += ms),
    }),
  ).rejects.toThrow(
    /cluster kore-local.*API server \(\/readyz\).*connection refused/s,
  );
});

test("cluster up times out naming the node that is not Ready", async () => {
  const repository = await loadRepository("local");
  let now = 0;
  const runner = {
    async run(_command: string, args: readonly string[]) {
      if (args.some((arg) => arg.startsWith("jsonpath={range"))) {
        return { stdout: "kore-local=False\n", stderr: "", code: 0 };
      }
      return { stdout: "ok", stderr: "", code: 0 };
    },
  };
  await expect(
    clusterUp(repository, runner, {
      timeoutMs: 10_000,
      now: () => now,
      sleep: async (ms) => void (now += ms),
    }),
  ).rejects.toThrow(/node kore-local is not Ready/);
});
