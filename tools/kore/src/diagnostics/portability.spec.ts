import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import { validatePortability } from "./portability.js";

test("portability validation accepts the reference application and managed environment", async () => {
  const repository = await loadRepository("managed-example");

  const result = await validatePortability(repository);

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
    validatePortability({ ...repository, root }),
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
    validatePortability({ ...repository, root }),
    /environment overlay/i,
  );
});
