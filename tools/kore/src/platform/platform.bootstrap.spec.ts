import { loadRepository } from "../config/index.js";
import { withHealthyWebhooks } from "../testing/index.js";
import { desiredFingerprint } from "./fingerprint.js";
import assert from "node:assert/strict";
import { test, vi } from "vitest";
// The admission gate is covered in platform.admission-gate.spec.ts.
vi.mock("./admission-gate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./admission-gate.js")>()),
  closeExistingAdmissionGate: async () => undefined,
  openAdmissionGate: async () => undefined,
}));
import { runningK3dCluster } from "./k3d-fixtures.js";
import { bootstrapControllers } from "./bootstrap.js";
import { platformStop, platformDestroy } from "./lifecycle.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Runner } from "../runtime/index.js";
import { RecordingRunner } from "../runtime/index.js";
import { tmpdir } from "node:os";

test("controller bootstrap reconciles controllers before shared Gateway configuration", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([
    { stdout: runningK3dCluster, stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
  ]);

  await bootstrapControllers(repository, withHealthyWebhooks(runner));

  const releases = runner.calls
    .filter(({ command, args }) => command === "helm" && args[0] === "upgrade")
    .map(({ args }) => args[2]);
  assert.ok(releases.includes("opentelemetry-operator"));
  assert.equal(releases.includes("kore-platform-config"), false);
});

test("controller bootstrap resumes a deployed component without another Helm upgrade", async () => {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(
    ({ name }) => name === "kore-postgresql-rbac",
  )!;
  repository.catalog.components = [
    { ...component, dependencies: [], readiness: [] },
  ];
  const runner = new RecordingRunner([
    { stdout: runningK3dCluster, stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
    {
      stdout: JSON.stringify({ info: { status: "deployed" } }),
      stderr: "",
      code: 0,
    },
    {
      stdout: JSON.stringify([
        {
          status: "deployed",
          description: desiredFingerprint(repository, component),
        },
      ]),
      stderr: "",
      code: 0,
    },
  ]);

  await bootstrapControllers(repository, withHealthyWebhooks(runner));

  assert.equal(
    runner.calls.some(
      ({ command, args }) => command === "helm" && args[0] === "upgrade",
    ),
    false,
  );
});

function k3dLifecycleRunner(): Runner {
  return {
    async run(command, args) {
      if (command === "k3d" && args[1] === "list") {
        return { stdout: runningK3dCluster, stderr: "", code: 0 };
      }
      const name = args.includes("jsonpath={.metadata.name}");
      return { stdout: name ? "kube-system" : "", stderr: "", code: 0 };
    },
  };
}

test("platform stop stops the k3d cluster", async () => {
  const repository = await loadRepository("local");
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: Runner = {
    run: async (command, args, options) => {
      calls.push({ command, args });
      return await k3dLifecycleRunner().run(command, args, options);
    },
  };

  await platformStop(repository, runner, { listProcesses: async () => [] });

  assert.deepEqual(calls.at(-1), {
    command: "k3d",
    args: ["cluster", "stop", "kore-local"],
  });
});

test("platform destroy purges and then deletes the k3d cluster", async () => {
  const repository = await loadRepository("local");
  const home = await mkdtemp(join(tmpdir(), "kore-platform-destroy-home-"));
  const previousHome = process.env["HOME"];
  process.env["HOME"] = home;
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: Runner = {
    run: async (command, args, options) => {
      calls.push({ command, args });
      return await k3dLifecycleRunner().run(command, args, options);
    },
  };
  try {
    await platformDestroy(repository, runner, { yes: true, purgeData: true });
    assert.deepEqual(calls.at(-1), {
      command: "k3d",
      args: ["cluster", "delete", "kore-local"],
    });
    assert.equal(
      calls.filter(({ args }) => args.includes("--selector")).length,
      2,
    );
  } finally {
    if (previousHome === undefined) {
      delete process.env["HOME"];
    } else {
      process.env["HOME"] = previousHome;
    }
    await rm(home, { recursive: true, force: true });
  }
});

test("controller bootstrap installs no shared composition, issuer, gateway, secret store, or OPA authorizer", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([
    { stdout: runningK3dCluster, stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
  ]);
  await bootstrapControllers(repository, withHealthyWebhooks(runner));

  const bootstrapped = repository.catalog.components.filter(
    ({ phase }) => phase !== "configuration" && phase !== "enforcement",
  );
  const shared =
    /^(crd\/)?(postgresqlinstances\.platform|compositions?|compositeresourcedefinitions?\/|clusterissuer|issuer|gateway\/|gatewayclass|secretstore|clustersecretstore)/;
  for (const component of bootstrapped) {
    assert.notEqual(
      component.name,
      "opa-authorizer",
      "the OPA authorizer belongs to the configuration phase",
    );
    assert.deepEqual(
      component.readiness.filter((resource) => shared.test(resource)),
      [],
      `${component.name} readiness names a shared resource`,
    );
    assert.equal(
      component.ownsCRDs.includes("postgresqlinstances.platform.kore.dev"),
      false,
      `${component.name} installs the shared PostgreSQL XRD`,
    );
    assert.equal(
      /^infra\/(apis\/postgresql|charts\/(platform-certificate|platform-config|opa-authorizer))/.test(
        component.source ?? component.chart ?? "",
      ),
      false,
      `${component.name} installs shared platform configuration`,
    );
  }
  const releases = runner.calls
    .filter(({ command, args }) => command === "helm" && args[0] === "upgrade")
    .map(({ args }) => args[2]);
  assert.equal(releases.includes("opa-authorizer"), false);
  assert.equal(releases.includes("kore-postgresql-api"), false);
});
