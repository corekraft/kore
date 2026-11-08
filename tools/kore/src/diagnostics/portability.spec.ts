import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import type { Runner, RunResult } from "../runtime/index.js";
import { loadRepository } from "../config/index.js";
import { validatePortability } from "./portability.js";

function fakeRunner(stdout = "kind: ConfigMap\n") {
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: Runner = {
    async run(command, args): Promise<RunResult> {
      calls.push({ command, args });
      return { stdout, stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

test("portability validation accepts the reference application and managed environment", async () => {
  const repository = await loadRepository("managed-example");

  const result = await validatePortability(repository, fakeRunner().runner);

  assert.deepEqual(result.applications, ["reference"]);
  assert.equal(result.environment, "managed-example");
});

test("portability validation rejects provider-specific application templates", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-portability-"));
  await mkdir(join(root, "apps/example/charts/resources"), { recursive: true });
  await mkdir(join(root, "apps/example/charts/workload/templates"), {
    recursive: true,
  });
  await writeFile(
    join(root, "apps/example/charts/resources/Chart.yaml"),
    "name: resources\n",
  );
  await writeFile(
    join(root, "apps/example/charts/workload/Chart.yaml"),
    "name: workload\n",
  );
  await writeFile(
    join(root, "apps/example/charts/workload/templates/deployment.yaml"),
    "kind: DaemonSet\n# minikube-only\n",
  );
  const repository = await loadRepository("managed-example");

  await assert.rejects(
    validatePortability({ ...repository, root }, fakeRunner().runner),
    /provider-specific.*minikube/i,
  );
});

test("portability validation rejects application charts that import an environment overlay", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-overlay-"));
  await mkdir(join(root, "apps/example/charts/resources"), { recursive: true });
  await mkdir(join(root, "apps/example/charts/workload"), { recursive: true });
  await writeFile(
    join(root, "apps/example/charts/resources/Chart.yaml"),
    "name: resources\n",
  );
  await writeFile(
    join(root, "apps/example/charts/workload/Chart.yaml"),
    "name: workload\n",
  );
  await writeFile(
    join(root, "apps/example/charts/workload/values.yaml"),
    "values: infra/environments/local/values/platform-config.yaml\n",
  );
  const repository = await loadRepository("managed-example");

  await assert.rejects(
    validatePortability({ ...repository, root }, fakeRunner().runner),
    /environment overlay/i,
  );
});

test("portability validation renders every application chart with common values only", async () => {
  const repository = await loadRepository("managed-example");
  const { runner, calls } = fakeRunner();

  await validatePortability(repository, runner);

  const charts = calls
    .map((call) => String(call.args[2]))
    .sort((a, b) => a.localeCompare(b));
  assert.deepEqual(charts, [
    join(repository.root, "apps/reference/charts/resources"),
    join(repository.root, "apps/reference/charts/workload"),
  ]);
  for (const call of calls) {
    assert.equal(call.command, "helm");
    assert.equal(call.args[0], "template");
    assert.ok(!call.args.includes("--values"), "no overlay values");
    assert.ok(!call.args.includes("-f"), "no overlay values");
  }
});

test("portability validation rejects rendered output that names a provider", async () => {
  const repository = await loadRepository("managed-example");
  const { runner } = fakeRunner(
    "kind: StorageClass\nprovisioner: k8s.io/minikube-hostpath\n",
  );

  await assert.rejects(
    validatePortability(repository, runner),
    /reference.*rendered.*provider-specific.*minikube/i,
  );
});

test("portability validation fails when an application chart does not render", async () => {
  const repository = await loadRepository("managed-example");
  const runner: Runner = {
    async run() {
      throw new Error("helm template failed (1): bad template");
    },
  };

  await assert.rejects(
    validatePortability(repository, runner),
    /reference.*bad template/i,
  );
});
