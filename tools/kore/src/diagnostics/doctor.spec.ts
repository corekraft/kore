import { loadManagedLocal } from "../testing/index.js";
import assert from "node:assert/strict";
import { test } from "vitest";
import { managedCluster } from "../config/index.js";
import { doctor, doctorFailed } from "./doctor.js";
import type { RunOptions, RunResult, Runner } from "../runtime/index.js";

class MismatchRunner implements Runner {
  async run(
    command: string,
    _args: readonly string[],
    _options?: RunOptions,
  ): Promise<RunResult> {
    if (command === "docker") {
      return { stdout: "0.0.0", stderr: "", code: 0 };
    }
    return { stdout: "0.0.0", stderr: "", code: 0 };
  }
}

test("doctor distinguishes optional version warnings from required failures", async () => {
  const checks = await doctor(await loadManagedLocal(), new MismatchRunner());
  assert.equal(
    checks.find(({ name }) => name === "tool:kubectl")?.status,
    "fail",
  );
  assert.equal(checks.find(({ name }) => name === "tool:sops")?.status, "warn");
});

test("doctor reports unavailable tools and daemon failures", async () => {
  const runner: Runner = {
    async run(command, args) {
      if (command === "docker" && args[0] === "info") {
        throw new Error("daemon is down");
      }
      if (command === "tofu") {
        throw new Error("not installed");
      }
      return { stdout: "version v99.1.2", stderr: "", code: 0 };
    },
  };
  const checks = await doctor(await loadManagedLocal(), runner);

  assert.equal(checks.find(({ name }) => name === "tool:tofu")?.status, "warn");
  assert.equal(
    checks.find(({ name }) => name === "container-runtime")?.status,
    "fail",
  );
  assert.equal(doctorFailed(checks), true);
});

test("doctor requires managed credentials and checks no local cluster", async () => {
  const base = await loadManagedLocal();
  const repository = {
    ...base,
    environment: { ...base.environment, kubeContext: "REQUIRED" },
  };
  const runner: Runner = {
    async run(command, args) {
      if (command === "docker" && args[0] === "info") {
        return { stdout: "", stderr: "", code: 0 };
      }
      return { stdout: "unknown version", stderr: "", code: 0 };
    },
  };
  const checks = await doctor(repository, runner);

  assert.deepEqual(
    checks.find(({ name }) => name === "credentials"),
    {
      name: "credentials",
      status: "fail",
      required: true,
      message: "managed environment credentials/context are not configured",
    },
  );
  assert.equal(
    checks.some(({ name }) => name === "k3d-cluster" || name === "tool:k3d"),
    false,
  );
  assert.equal(doctorFailed(checks), true);
});

test("doctor reports checks in a fixed order with pass messages for matching tools", async () => {
  const repository = await loadManagedLocal();
  const runner: Runner = {
    async run(command) {
      const pinned = repository.versions.tools[command] ?? "0.0.0";
      return { stdout: `v${pinned}`, stderr: "", code: 0 };
    },
  };
  const checks = await doctor(repository, runner);
  const names = checks.map(({ name }) => name);

  assert.deepEqual(names.slice(-5), [
    "container-runtime",
    "host:cpu",
    "host:memory",
    "host:disk",
    "credentials",
  ]);
  assert.ok(names.slice(0, -5).every((name) => name.startsWith("tool:")));
  const kubectl = checks.find(({ name }) => name === "tool:kubectl");
  assert.equal(kubectl?.status, "pass");
  assert.equal(
    kubectl?.message,
    `${repository.versions.tools["kubectl"]} (pinned ${repository.versions.tools["kubectl"]})`,
  );
  assert.deepEqual(
    checks.find(({ name }) => name === "credentials"),
    {
      name: "credentials",
      status: "pass",
      required: true,
      message: "managed context is configured",
    },
  );
});

test("doctor accepts a configured managed context and fails host checks that exceed the machine", async () => {
  const base = await loadManagedLocal();
  const repository = {
    ...base,
    environment: {
      ...base.environment,
      kubeContext: "prod-context",
      cluster: {
        ...managedCluster(base.environment),
        cpus: 100000,
        memoryMB: 100000000,
        diskSize: "100000000g",
      },
    },
  };
  const runner: Runner = {
    async run() {
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  const checks = await doctor(repository, runner);
  const byName = (name: string) => checks.find((check) => check.name === name);

  assert.deepEqual(byName("credentials"), {
    name: "credentials",
    status: "pass",
    required: true,
    message: "managed context is configured",
  });
  assert.equal(byName("host:cpu")?.status, "fail");
  assert.match(byName("host:cpu")?.message ?? "", /available, 100000 required/);
  assert.equal(byName("host:memory")?.status, "fail");
  assert.equal(byName("host:disk")?.status, "fail");
  assert.match(
    byName("host:disk")?.message ?? "",
    /GiB free, 100000000 GiB required/,
  );
});
