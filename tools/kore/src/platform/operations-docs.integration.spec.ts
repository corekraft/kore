import assert from "node:assert/strict";
import test from "node:test";
import { assertExpectedCluster } from "../cluster/index.js";
import { findRoot } from "../config/config.js";
import { loadRepository } from "../config/index.js";
import { ProcessRunner, type Runner } from "../runtime/index.js";
import { platformStatusReport } from "./crd-ownership-status.js";

// Docs: docs/operations/resource-budgets.md
// Live and opt-in: needs a running local profile. Read-only throughout: only
// `kubectl get` of non-Secret resources, no image is pulled or run, and
// nothing is created, so there is nothing to clean up. Proves the claims the
// operations pages make that no offline test can: the `capacity` row reads a
// real node, the registry claim is the disposable class the registry page
// states, and registry storage deletion is off as the garbage-collection
// gap says.

interface Claim {
  spec: { storageClassName?: string };
  metadata: { labels?: Record<string, string> };
}
interface Deployment {
  spec: { template: { spec: { containers: { env?: { name: string }[] }[] } } };
}

async function get<T>(
  runner: Runner,
  kubeContext: string,
  args: string[],
): Promise<T> {
  const { stdout } = await runner.run(
    "kubectl",
    ["--context", kubeContext, "get", ...args, "--output", "json"],
    { capture: true },
  );
  return JSON.parse(stdout) as T;
}

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_INTEGRATION !== "1"
      ? "set KORE_RUN_INTEGRATION=1 to opt into a live local profile"
      : false,
  timeout: 5 * 60 * 1000,
};

test(
  "platform status reports a capacity row from the live node that matches its warning rule",
  live,
  async () => {
    const repository = await loadRepository("local", await findRoot());
    const runner = new ProcessRunner();
    await assertExpectedCluster(repository, runner);

    const rows = await platformStatusReport(repository, runner);
    const row = rows.find((r) => r.name === "capacity");

    assert.ok(row, "capacity row is missing from platform status");
    assert.notEqual(row.status, "missing", row.detail);
    const capacity = (row as { capacity?: Record<string, number> }).capacity!;
    const over = Math.max(
      capacity.cpuRequestedPercent!,
      capacity.memoryRequestedPercent!,
    );
    assert.equal(
      row.status === "degraded",
      over >= capacity.warningPercent!,
      row.detail,
    );
    for (const name of ["registry-trust", "image-inventory", "crd-ownership"]) {
      assert.ok(
        rows.some((r) => r.name === name),
        `${name} row is missing`,
      );
    }
  },
);

test(
  "the registry claim is the disposable class the registry page documents, and storage deletion is off",
  live,
  async () => {
    const repository = await loadRepository("local", await findRoot());
    const runner = new ProcessRunner();
    const kubeContext = repository.environment.kubeContext;
    await assertExpectedCluster(repository, runner);

    const claims = await get<{ items: Claim[] }>(runner, kubeContext, [
      "pvc",
      "--namespace",
      "kore-registry",
    ]);
    assert.ok(claims.items.length > 0, "no registry claim found");
    for (const claim of claims.items) {
      assert.equal(claim.spec.storageClassName, "kore-standard");
      assert.equal(
        claim.metadata.labels?.["platform.kore.dev/retention"],
        "Delete",
      );
    }

    const deployment = await get<Deployment>(runner, kubeContext, [
      "deployment/oci-registry",
      "--namespace",
      "kore-registry",
    ]);
    const env = deployment.spec.template.spec.containers.flatMap((c) =>
      (c.env ?? []).map((e) => e.name),
    );
    assert.ok(
      !env.includes("REGISTRY_STORAGE_DELETE_ENABLED"),
      "storage deletion is enabled: update the garbage-collection section of docs/operations/registry.md",
    );
  },
);
