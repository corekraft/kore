import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import {
  assertExpectedCluster,
  clusterDestroy,
  clusterStartArgs,
  clusterUp,
  clusterStatus,
  clusterStop,
  hasVerifiedExport,
  retainedResources,
} from "./cluster.js";
import { loadRepository } from "../config/index.js";
import { CommandError } from "../runtime/index.js";
import { RecordingRunner } from "../runtime/runner.js";

function mockStdout(command: string, args: readonly string[]): string {
  if (command === "minikube" && args[0] === "status") {
    return '{"Host":"Running"}';
  }
  if (command === "kubectl" && args.includes("jsonpath={.metadata.name}")) {
    return "kube-system";
  }
  return "";
}

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
    "--keep-context=false",
  ]);
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

test("retained data blocks cluster deletion", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([
    { stdout: "{}", stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
    {
      stdout: "postgresqlinstance.platform.kore.dev/reference-db\n",
      stderr: "",
      code: 0,
    },
    { stdout: "", stderr: "", code: 0 },
  ]);
  await assert.rejects(
    clusterDestroy(repository, runner, { yes: true, purgeData: false }),
    /destroy blocked by retained data/,
  );
  assert.equal(
    runner.calls.some((call) => call.args.includes("delete")),
    false,
  );
});

test("purging retained data explicitly deletes retained claims before the profile", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([
    { stdout: "{}", stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
    {
      stdout: "postgresqlinstance.platform.kore.dev/reference-db\n",
      stderr: "",
      code: 0,
    },
    { stdout: "persistentvolumeclaim/reference-db-1\n", stderr: "", code: 0 },
  ]);

  await clusterDestroy(repository, runner, { yes: true, purgeData: true });
  const deleteCalls = runner.calls.filter(
    ({ command, args }) => command === "kubectl" && args.includes("delete"),
  );
  assert.equal(deleteCalls.length, 2);
  assert.ok(
    deleteCalls.every(
      ({ args }) =>
        args.includes("--all-namespaces") &&
        args.includes("--ignore-not-found"),
    ),
  );
  assert.equal(runner.calls.at(-1)?.command, "minikube");
  assert.equal(runner.calls.at(-1)?.args[0], "delete");
});

test("purge tolerates a PostgreSQL CRD that was never installed", async () => {
  const repository = await loadRepository("local");
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner = {
    async run(command: string, args: readonly string[]) {
      calls.push({ command, args });
      if (
        command === "kubectl" &&
        args.includes("delete") &&
        args.includes("postgresqlinstances.platform.kore.dev")
      ) {
        throw new Error(
          'the server doesn\'t have a resource type "postgresqlinstances"',
        );
      }
      return {
        stdout: mockStdout(command, args),
        stderr: "",
        code: 0,
      };
    },
  };

  await clusterDestroy(repository, runner, { yes: true, purgeData: true });

  assert.ok(
    calls.some(
      ({ command, args }) =>
        command === "kubectl" &&
        args.includes("delete") &&
        args.includes("pvc"),
    ),
  );
  assert.equal(calls.at(-1)?.command, "minikube");
  assert.equal(calls.at(-1)?.args[0], "delete");
});

test("verified exports allow destroying an unreachable profile without purging data", async () => {
  const repository = await loadRepository("local");
  const exportDirectory = join(
    repository.root,
    ".kore",
    "exports",
    repository.environment.name,
  );
  await mkdir(exportDirectory, { recursive: true });
  const exportFile = join(exportDirectory, "reference.sql");
  const exportContents = "CREATE TABLE reference (id integer);\n";
  await writeFile(exportFile, exportContents);
  const checksum = join(exportDirectory, "reference.sql.sha256");
  await writeFile(
    checksum,
    `${createHash("sha256").update(exportContents).digest("hex")}  reference.sql\n`,
  );
  const runner = new RecordingRunner();
  try {
    await clusterDestroy(repository, runner, { yes: true, purgeData: false });
  } finally {
    await rm(exportDirectory, { recursive: true, force: true });
  }
  assert.equal(runner.calls.at(-1)?.args[0], "delete");
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

test("retained resource discovery ignores unavailable APIs, trims, deduplicates, and sorts", async () => {
  const repository = await loadRepository("local");
  let query = 0;
  const runner = {
    async run() {
      query += 1;
      if (query === 1) {
        return {
          stdout:
            " postgresqlinstance.platform.kore.dev/reference-db \npostgresqlinstance.platform.kore.dev/reference-db\n",
          stderr: "",
          code: 0,
        };
      }
      throw new CommandError("kubectl", ["get", "pvc"], {
        stdout: "",
        stderr: 'error: the server doesn\'t have a resource type "pvc"',
        code: 1,
      });
    },
  };

  assert.deepEqual(await retainedResources(repository, runner), [
    "postgresqlinstance.platform.kore.dev/reference-db",
  ]);
});

test("a missing PostgreSQL CRD counts as no retained data", async () => {
  const repository = await loadRepository("local");
  let query = 0;
  const runner = {
    async run() {
      query += 1;
      if (query === 1) {
        throw new CommandError("kubectl", ["get"], {
          stdout: "",
          stderr:
            'error: the server doesn\'t have a resource type "postgresqlinstances"',
          code: 1,
        });
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  assert.deepEqual(await retainedResources(repository, runner), []);
});

test("an unreachable cluster blocks destroy instead of counting as no retained data", async () => {
  const repository = await loadRepository("local");
  const runner = {
    calls: [] as string[][],
    async run(command: string, args: readonly string[]) {
      this.calls.push([command, ...args]);
      if (command === "kubectl" && args.includes("get")) {
        throw new CommandError(command, args, {
          stdout: "",
          stderr:
            "Unable to connect to the server: dial tcp 192.168.49.2:8443: i/o timeout",
          code: 1,
        });
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  await assert.rejects(
    retainedResources(repository, runner),
    /Unable to connect/,
  );
  await assert.rejects(
    clusterDestroy(repository, runner, { yes: true, purgeData: false }),
    /Unable to connect/,
  );
  assert.equal(
    runner.calls.some((call) => call.includes("delete")),
    false,
  );
});

test("cluster up starts the configured profile then validates its context", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([
    { stdout: "", stderr: "", code: 0 },
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

test("export verification rejects malformed or mismatched checksum files", async () => {
  const repository = await loadRepository("local");
  const exportDirectory = join(
    repository.root,
    ".kore",
    "exports",
    repository.environment.name,
  );
  await mkdir(exportDirectory, { recursive: true });
  try {
    await writeFile(
      join(exportDirectory, "invalid.sha256"),
      "not a checksum\n",
    );
    await writeFile(
      join(exportDirectory, "missing-name.sha256"),
      `${"a".repeat(64)}\n`,
    );
    await writeFile(
      join(exportDirectory, "missing-name"),
      "different contents",
    );
    assert.equal(await hasVerifiedExport(repository), false);
  } finally {
    await rm(exportDirectory, { recursive: true, force: true });
  }
});
