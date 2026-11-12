import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
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

async function applicationRoot(
  prefix: string,
  workloadTemplate: string,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
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
    workloadTemplate,
  );
  return root;
}

for (const name of ["k3d", "k3s", "local-path"]) {
  test(`portability validation rejects application templates that name ${name}`, async () => {
    const root = await applicationRoot(
      "kore-provider-",
      `kind: PersistentVolumeClaim\nstorageClassName: ${name}\n`,
    );
    const repository = await loadRepository("managed-example");

    await assert.rejects(
      validatePortability({ ...repository, root }, fakeRunner().runner),
      (error: Error) =>
        error.message.includes(name) &&
        /provider-specific/.test(error.message) &&
        /environment overlay/.test(error.message) &&
        /deployment\.yaml/.test(error.message),
    );
  });

  test(`portability validation rejects rendered output that names ${name}`, async () => {
    const repository = await loadRepository("managed-example");
    const { runner } = fakeRunner(
      `kind: PersistentVolumeClaim\nstorageClassName: ${name}\n`,
    );

    await assert.rejects(
      validatePortability(repository, runner),
      (error: Error) =>
        /rendered.*provider-specific/.test(error.message) &&
        /environment overlay/.test(error.message) &&
        error.message.includes(name),
    );
  });
}

test("portability validation scans only apps/ and reads nothing outside it", async () => {
  const root = await applicationRoot(
    "kore-provider-scope-",
    "kind: Deployment\nmetadata:\n  name: example\n",
  );
  const infra = join(root, "infra");
  await mkdir(join(infra, "environments/local"), { recursive: true });
  await writeFile(
    join(infra, "environments/local/storage.yaml"),
    "provisioner: rancher.io/local-path\ncluster: k3d-kore\nimage: rancher/k3s\n",
  );
  // An unreadable infra/ proves no file outside apps/ is read.
  await chmod(infra, 0o000);
  try {
    const repository = await loadRepository("managed-example");

    const result = await validatePortability(
      { ...repository, root },
      fakeRunner().runner,
    );

    assert.deepEqual(result.applications, ["example"]);
  } finally {
    await chmod(infra, 0o755);
  }
});

const flaggedValues = [
  "provisioner: rancher.io/local-path",
  "storageClassName: local-path",
  "image: rancher/k3s:v1",
  "cluster: k3d-kore",
  "token: ${k3s_token}",
  "path: local_path",
];
const neutralValues = [
  "cache-local-path: enabled",
  "mountPath: /data/local-path/cache",
];

for (const value of flaggedValues) {
  test(`portability validation flags the provider value ${value}`, async () => {
    const root = await applicationRoot("kore-provider-", `${value}\n`);
    const repository = await loadRepository("managed-example");

    await assert.rejects(
      validatePortability({ ...repository, root }, fakeRunner().runner),
      /provider-specific/,
    );
  });
}

for (const value of neutralValues) {
  test(`portability validation accepts the neutral value ${value}`, async () => {
    const root = await applicationRoot("kore-provider-", `${value}\n`);
    const repository = await loadRepository("managed-example");

    const result = await validatePortability(
      { ...repository, root },
      fakeRunner().runner,
    );

    assert.deepEqual(result.applications, ["example"]);
  });
}
