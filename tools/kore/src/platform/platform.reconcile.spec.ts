import { loadMinikubeLocal } from "../config/minikube-local-support.js";
import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, orderedComponents } from "../config/index.js";
import { reconcileComponent } from "./reconcile.js";
import { helmUpgradeArgs } from "./helm.js";
import { platformRender } from "./render.js";
import { platformStatus } from "./status.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Runner } from "../runtime/index.js";
import { RecordingRunner } from "../runtime/runner.js";
import { tmpdir } from "node:os";

test("the PostgreSQL connection secret is explicitly marked ready for Crossplane", async () => {
  const repository = await loadMinikubeLocal();
  const composition = await (
    await import("node:fs/promises")
  ).readFile(
    `${repository.root}/infra/apis/postgresql/compositions/local.yaml`,
    "utf8",
  );

  assert.match(composition, /gotemplating\.fn\.crossplane\.io\/ready: "True"/);
});

test("the local registry is bootstrapped before shared platform configuration", async () => {
  const repository = await loadMinikubeLocal();
  const order = orderedComponents(repository.catalog).map(({ name }) => name);

  assert.ok(order.indexOf("oci-registry") >= 0);
  assert.ok(
    order.indexOf("oci-registry") < order.indexOf("kore-platform-config"),
  );
});

test("the TLS certificate and complete TLS Secret are ready before Gateway configuration", async () => {
  const repository = await loadMinikubeLocal();
  const order = orderedComponents(repository.catalog).map(({ name }) => name);
  const certificate = repository.catalog.components.find(
    ({ name }) => name === "kore-local-tls",
  )!;
  const gateway = repository.catalog.components.find(
    ({ name }) => name === "kore-platform-config",
  )!;

  assert.ok(certificate);
  assert.ok(
    order.indexOf("kore-local-tls") < order.indexOf("kore-platform-config"),
  );
  assert.ok(gateway.dependencies.includes("kore-local-tls"));
  assert.deepEqual(certificate.readiness, [
    "certificate/kore-local",
    "secret/kore-local-tls",
  ]);

  const runner = new RecordingRunner([
    { stdout: "", stderr: "", code: 0 },
    { stdout: "", stderr: "", code: 0 },
    { stdout: "", stderr: "", code: 0 },
    { stdout: "ready", stderr: "", code: 0 },
  ]);
  await reconcileComponent(repository, runner, certificate);
  assert.ok(
    runner.calls.some(
      ({ command, args }) =>
        command === "kubectl" && args.includes("certificate/kore-local"),
    ),
  );
  assert.ok(
    runner.calls.some(
      ({ command, args }) =>
        command === "kubectl" &&
        args.some((arg) => arg.includes("tls.crt") && arg.includes("tls.key")),
    ),
  );
});

test("helm construction always uses explicit context, namespace, pin, and timeout", async () => {
  const repository = await loadMinikubeLocal();
  const component = repository.catalog.components.find(
    ({ name }) => name === "crossplane",
  )!;
  const args = helmUpgradeArgs(repository, component);
  assert.ok(args.includes("--kube-context"));
  assert.ok(args.includes("kore-local"));
  assert.ok(args.includes("--namespace"));
  assert.ok(args.includes("--version"));
  assert.ok(args.includes(repository.versions.components.crossplane!));
  assert.ok(args.includes("--timeout"));
  assert.ok(args.includes("--rollback-on-failure"));
  assert.equal(args.includes("--atomic"), false);
});

test("render validation sends rendered manifests to kubectl over stdin", async () => {
  const repository = await loadMinikubeLocal();
  repository.catalog.components = [
    {
      ...repository.catalog.components.find(
        ({ name }) => name === "opa-authorizer",
      )!,
      dependencies: [],
    },
  ];
  const runner = new RecordingRunner([
    { stdout: "apiVersion: v1\nkind: Service\n", stderr: "", code: 0 },
    { stdout: "", stderr: "", code: 0 },
  ]);
  await platformRender(repository, runner);
  assert.equal(runner.calls[1]?.command, "kubectl");
  assert.match(runner.calls[1]?.options?.input ?? "", /kind: Service/);
});

test("managed environments do not inherit local-only component values", async () => {
  const repository = await loadRepository("managed-example");
  const prometheus = repository.catalog.components.find(
    ({ name }) => name === "prometheus",
  )!;

  const valueFiles = helmUpgradeArgs(repository, prometheus).filter((value) =>
    value.endsWith(".yaml"),
  );
  // The shared digest pins apply everywhere; only local overlays are excluded.
  assert.ok(
    valueFiles.some((file) => file.endsWith("/common/values/prometheus.yaml")),
  );
  assert.deepEqual(
    valueFiles.filter((file) => file.includes("/environments/local/")),
    [],
  );
});

test("managed environments select platform infrastructure through an overlay", async () => {
  const repository = await loadRepository("managed-example");
  const platformConfig = repository.catalog.components.find(
    ({ name }) => name === "kore-platform-config",
  )!;
  const args = helmUpgradeArgs(repository, platformConfig);

  assert.ok(
    args.some((value) =>
      value.endsWith(
        "/infra/environments/managed-example/values/platform-config.yaml",
      ),
    ),
  );
  assert.equal(
    args.some((value) => value.includes("environments/local/")),
    false,
  );
});

test("manifest components apply nested manifest directories recursively", async () => {
  const repository = await loadMinikubeLocal();
  const component = repository.catalog.components.find(
    ({ name }) => name === "kore-postgresql-api",
  )!;
  const runner = new RecordingRunner();

  await reconcileComponent(repository, runner, component);

  assert.ok(runner.calls[0]?.args.includes("--recursive"));
});

test("retries an asynchronously-created CRD until it is established", async () => {
  const repository = await loadMinikubeLocal();
  const component = repository.catalog.components.find(
    ({ name }) => name === "kore-postgresql-api",
  )!;
  let waits = 0;
  const runner: Runner = {
    async run(command, args) {
      if (command === "kubectl" && args.includes("wait")) {
        waits++;
        if (waits === 1) {
          throw new Error(
            "customresourcedefinitions.apiextensions.k8s.io not found",
          );
        }
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await reconcileComponent(repository, runner, component);
  assert.equal(waits, 3);
});

test("preserves CRD wait errors so an asynchronous NotFound is retried", async () => {
  const repository = await loadMinikubeLocal();
  const component = repository.catalog.components.find(
    ({ name }) => name === "kore-postgresql-api",
  )!;
  let waits = 0;
  const runner: Runner = {
    async run(command, args, options) {
      if (command === "kubectl" && args.includes("wait")) {
        waits++;
        if (waits === 1) {
          if (options?.capture !== true) {
            throw new Error("kubectl wait failed (1):");
          }
          throw new Error(
            "kubectl wait failed (1): customresourcedefinition not found",
          );
        }
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await reconcileComponent(repository, runner, component);
  assert.equal(waits, 3);
});

test("render validation checks manifest components without mutating the cluster", async () => {
  const repository = await loadMinikubeLocal();
  const component = repository.catalog.components.find(
    ({ name }) => name === "kore-postgresql-api",
  )!;
  repository.catalog.components = [{ ...component, dependencies: [] }];
  const runner = new RecordingRunner();

  await platformRender(repository, runner);

  assert.equal(runner.calls.length, 1);
  assert.equal(runner.calls[0]?.command, "kubectl");
  assert.ok(runner.calls[0]?.args.includes("--dry-run=client"));
  assert.ok(runner.calls[0]?.args.includes("--recursive"));
});

test("platform status reports a failed Helm release as degraded", async () => {
  const repository = await loadMinikubeLocal();
  const component = repository.catalog.components.find(
    ({ name }) => name === "opa-authorizer",
  )!;
  repository.catalog.components = [{ ...component, dependencies: [] }];
  const runner = new RecordingRunner([
    {
      stdout: JSON.stringify({ info: { status: { status: "failed" } } }),
      stderr: "",
      code: 0,
    },
  ]);

  const [status] = await platformStatus(repository, runner);

  assert.ok(status);
  assert.equal(status.status, "degraded");
  assert.match(status.detail, /failed/i);
});

test("platform render writes rendered Helm manifests to an output directory", async () => {
  const base = await loadMinikubeLocal();
  const root = await mkdtemp(join(tmpdir(), "kore-platform-render-output-"));
  const repository = { ...base, root };
  const component = base.catalog.components.find(
    ({ kind }) => kind === "helm",
  )!;
  repository.catalog.components = [{ ...component, dependencies: [] }];
  const runner: Runner = {
    async run(command) {
      return {
        stdout: command === "helm" ? "apiVersion: v1\nkind: ConfigMap\n" : "",
        stderr: "",
        code: 0,
      };
    },
  };
  try {
    await platformRender(repository, runner, "rendered");
    assert.equal(
      await readFile(join(root, "rendered", `${component.name}.yaml`), "utf8"),
      "apiVersion: v1\nkind: ConfigMap\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
