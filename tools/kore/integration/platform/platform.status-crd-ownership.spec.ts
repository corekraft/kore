import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../../src/config/index.js";
import type { Runner } from "../../src/runtime/index.js";
import {
  crdOwnershipStatus,
  platformStatusReport,
  platformStatus,
} from "../../src/platform/index.js";

// Docs: docs/decisions/0057-runtime-crd-ownership.md
// Cluster CRDs with no catalog owner, or more than one, are reported as
// degraded. The check is read-only and never fails `platform up` (audit first).

function crdList(...names: string[]): string {
  return JSON.stringify({
    items: names.map((name) => ({ metadata: { name } })),
  });
}

function cluster(crds: string | Error) {
  const calls: string[][] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push([command, ...args]);
      if (crds instanceof Error) {
        throw crds;
      }
      return { stdout: crds, stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

test("CRDs owned by name or by a claimed group, each by one component, are ready", async () => {
  const repository = await loadRepository("local");
  const { runner } = cluster(
    crdList(
      "configs.config.gatekeeper.sh",
      "functions.pkg.crossplane.io",
      "gotemplates.gotemplating.fn.crossplane.io",
      "koresecrets.constraints.gatekeeper.sh",
    ),
  );

  const result = await crdOwnershipStatus(repository, runner);

  assert.equal(result.status, "ready", result.detail);
  assert.deepEqual(result.crds, {
    total: 4,
    unowned: [],
    multiple: [],
    providerOwned: [],
  });
});

test("a cluster CRD with no catalog owner is degraded and named", async () => {
  const repository = await loadRepository("local");
  const { runner } = cluster(crdList("stray.example.dev"));

  const result = await crdOwnershipStatus(repository, runner);

  assert.equal(result.status, "degraded");
  assert.deepEqual(result.crds?.unowned, ["stray.example.dev"]);
  assert.match(result.detail, /stray\.example\.dev/);
  assert.match(result.detail, /no catalog owner/);
});

test("a cluster CRD with two catalog owners is degraded and names both", async () => {
  const repository = await loadRepository("local");
  const gatekeeper = repository.catalog.components.find(
    (c) => c.name === "gatekeeper",
  )!;
  const extra = repository.catalog.components.find(
    (c) => c.name === "kore-postgresql-api",
  )!;
  extra.ownsCRDs = [...extra.ownsCRDs, gatekeeper.ownsCRDs[0]!];
  const { runner } = cluster(crdList(gatekeeper.ownsCRDs[0]!));

  const result = await crdOwnershipStatus(repository, runner);

  assert.equal(result.status, "degraded");
  assert.deepEqual(result.crds?.multiple, [
    {
      name: gatekeeper.ownsCRDs[0],
      owners: ["gatekeeper", "kore-postgresql-api"],
    },
  ]);
  assert.match(result.detail, /gatekeeper and kore-postgresql-api/);
});

test("the check reads CRDs from the configured context and never mutates", async () => {
  const repository = await loadRepository("local");
  const { runner, calls } = cluster(crdList());

  await crdOwnershipStatus(repository, runner);

  assert.deepEqual(calls, [
    [
      "kubectl",
      "--context",
      repository.environment.kubeContext,
      "get",
      "crd",
      "--output",
      "json",
    ],
  ]);
});

test("CRDs that cannot be listed are reported as missing, not as clean", async () => {
  const repository = await loadRepository("local");
  const { runner } = cluster(new Error("connection refused"));

  const result = await crdOwnershipStatus(repository, runner);

  assert.equal(result.status, "missing");
  assert.match(result.detail, /connection refused/);
  assert.equal(result.crds, undefined);
});

test("the status report carries the CRD ownership row, a filtered query omits it, and the gating status never includes it", async () => {
  const repository = await loadRepository("local");
  const calls: string[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push(`${command} ${args.join(" ")}`);
      if (args.includes("crd") && args.includes("json")) {
        return { stdout: crdList("stray.example.dev"), stderr: "", code: 0 };
      }
      if (command === "helm") {
        throw new Error("release not found");
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  const all = await platformStatusReport(repository, runner);
  assert.equal(all.find((r) => r.name === "crd-ownership")?.status, "degraded");

  const filtered = await platformStatusReport(repository, runner, [
    "crossplane",
  ]);
  assert.equal(
    filtered.find((r) => r.name === "crd-ownership"),
    undefined,
  );

  const gating = await platformStatus(repository, runner);
  assert.equal(
    gating.find((r) => r.name === "crd-ownership"),
    undefined,
    "bootstrap and app up must not be gated by the audit",
  );
});

test("CRDs in a provider-owned group count as owned and are listed as provider-owned", async () => {
  const repository = await loadRepository("local");
  const { runner } = cluster(
    crdList(
      "addons.k3s.cattle.io",
      "helmcharts.helm.cattle.io",
      "configs.config.gatekeeper.sh",
    ),
  );

  const result = await crdOwnershipStatus(repository, runner);

  assert.equal(result.status, "ready", result.detail);
  assert.deepEqual(result.crds, {
    total: 3,
    unowned: [],
    multiple: [],
    providerOwned: ["addons.k3s.cattle.io", "helmcharts.helm.cattle.io"],
  });
  assert.match(result.detail, /2 provider-owned/);
});

test("a CRD in an undeclared group is still unowned next to provider-owned ones", async () => {
  const repository = await loadRepository("local");
  const { runner } = cluster(
    crdList("addons.k3s.cattle.io", "things.other.cattle.io"),
  );

  const result = await crdOwnershipStatus(repository, runner);

  assert.equal(result.status, "degraded");
  assert.deepEqual(result.crds?.unowned, ["things.other.cattle.io"]);
  assert.deepEqual(result.crds?.providerOwned, ["addons.k3s.cattle.io"]);
});

test("an environment without provider-owned groups reports k3s CRDs as unowned", async () => {
  const repository = await loadRepository("local");
  delete repository.environment.providerOwnedCRDGroups;
  const { runner } = cluster(crdList("addons.k3s.cattle.io"));

  const result = await crdOwnershipStatus(repository, runner);

  assert.equal(result.status, "degraded");
  assert.deepEqual(result.crds?.unowned, ["addons.k3s.cattle.io"]);
});
