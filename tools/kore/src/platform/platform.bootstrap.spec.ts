import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import { bootstrapControllers } from "./bootstrap.js";
import { platformStop, platformDestroy } from "./lifecycle.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Runner } from "../runtime/index.js";
import { RecordingRunner } from "../runtime/runner.js";
import { tmpdir } from "node:os";

test("controller bootstrap reconciles controllers before shared Gateway configuration", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
  ]);

  await bootstrapControllers(repository, runner);

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
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
    {
      stdout: JSON.stringify({ info: { status: "deployed" } }),
      stderr: "",
      code: 0,
    },
  ]);

  await bootstrapControllers(repository, runner);

  assert.equal(
    runner.calls.some(
      ({ command, args }) => command === "helm" && args[0] === "upgrade",
    ),
    false,
  );
});

test("platform stop removes managed tunnel state before stopping the cluster", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-platform-stop-"));
  const repository = { ...base, root };
  const runner = new RecordingRunner([
    { stdout: "{}", stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
    { stdout: "", stderr: "", code: 0 },
  ]);
  try {
    await platformStop(repository, runner);
    assert.deepEqual(runner.calls.at(-1)?.args, [
      "stop",
      "--profile",
      repository.environment.cluster.profile,
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("platform destroy stops the tunnel before purging and deleting the cluster", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-platform-destroy-"));
  const repository = { ...base, root };
  const runner = new RecordingRunner([
    { stdout: "{}", stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
    { stdout: "", stderr: "", code: 0 },
    { stdout: "", stderr: "", code: 0 },
    { stdout: "", stderr: "", code: 0 },
    { stdout: "", stderr: "", code: 0 },
  ]);
  try {
    await platformDestroy(repository, runner, { yes: true, purgeData: true });
    assert.equal(runner.calls.at(-1)?.args[0], "delete");
    assert.equal(
      runner.calls.filter(({ args }) => args.includes("--selector")).length,
      2,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("controller bootstrap creates a missing Minikube profile", async () => {
  const base = await loadRepository("local");
  const repository = {
    ...base,
    catalog: { components: [] },
  };
  let statusCalls = 0;
  const runner: Runner = {
    async run(command, args) {
      if (command === "minikube" && args[0] === "status") {
        statusCalls += 1;
        if (statusCalls === 1) {
          throw new Error("profile is stopped");
        }
      }
      if (command === "kubectl" && args.includes("jsonpath={.metadata.name}")) {
        return { stdout: "kube-system", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await bootstrapControllers(repository, runner);

  assert.equal(statusCalls, 2);
});

test("controller bootstrap installs no shared composition, issuer, gateway, secret store, or OPA authorizer", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
  ]);
  await bootstrapControllers(repository, runner);

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

test("bootstrap recreates a deployed registry whose Service drifted from the pin, without touching its data", async () => {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(
    ({ name }) => name === "oci-registry",
  )!;
  repository.catalog.components = [
    { ...component, dependencies: [], readiness: [] },
  ];
  const runner = new RecordingRunner([
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
    { stdout: "10.99.1.2", stderr: "", code: 0 },
  ]);

  await bootstrapControllers(repository, runner);

  const kinds = runner.calls.map(({ command, args }) =>
    command === "helm" ? `helm ${args[0]}` : `${command} ${args.join(" ")}`,
  );
  const deleted = runner.calls.filter(({ args }) => args.includes("delete"));
  assert.equal(deleted.length, 1);
  assert.deepEqual(deleted[0]?.args.slice(-4), [
    "delete",
    "service",
    "oci-registry",
    "--ignore-not-found",
  ]);
  assert.ok(
    kinds.indexOf("helm upgrade") >
      runner.calls.findIndex(({ args }) => args.includes("delete")),
  );
});
