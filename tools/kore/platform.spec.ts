import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, orderedComponents } from "./config.js";
import { helmUpgradeArgs, platformRender, platformStatus, platformUp, reconcileComponent } from "./platform.js";
import { RecordingRunner, type RunOptions, type RunResult, type Runner } from "./runner.js";

test("release graph order is stable", async () => {
  const repository = await loadRepository("local");
  const first = orderedComponents(repository.catalog).map(({name}) => name); const second = orderedComponents(repository.catalog).map(({name}) => name);
  assert.deepEqual(first,second); assert.ok(first.indexOf("cert-manager") < first.indexOf("opentelemetry-operator")); assert.ok(first.indexOf("crossplane") < first.indexOf("kore-platform-config"));
});

test("helm construction always uses explicit context, namespace, pin, and timeout", async () => {
  const repository = await loadRepository("local"); const component = repository.catalog.components.find(({name}) => name === "crossplane")!; const args = helmUpgradeArgs(repository,component);
  assert.ok(args.includes("--kube-context")); assert.ok(args.includes("kore-local")); assert.ok(args.includes("--namespace")); assert.ok(args.includes("--version")); assert.ok(args.includes("2.3.4")); assert.ok(args.includes("--timeout"));
  assert.ok(args.includes("--rollback-on-failure")); assert.equal(args.includes("--atomic"), false);
});

test("render validation sends rendered manifests to kubectl over stdin", async () => {
  const repository = await loadRepository("local");
  repository.catalog.components = [{...repository.catalog.components.find(({name}) => name === "opa-authorizer")!,dependencies:[]}];
  const runner = new RecordingRunner([{stdout:"apiVersion: v1\nkind: Service\n",stderr:"",code:0},{stdout:"",stderr:"",code:0}]);
  await platformRender(repository,runner);
  assert.equal(runner.calls[1]?.command,"kubectl");
  assert.match(runner.calls[1]?.options?.input ?? "",/kind: Service/);
});

test("platform up refuses a profile whose Kubernetes context is unexpected", async () => {
  const repository = await loadRepository("local");
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: Runner = {
    async run(command: string, args: readonly string[], _options?: RunOptions): Promise<RunResult> {
      calls.push({ command, args });
      if (command === "minikube" && args[0] === "status") {
        return { stdout: '{"Host":"Running"}', stderr: "", code: 0 };
      }
      if (command === "kubectl") {
        return { stdout: "wrong-cluster", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await assert.rejects(platformUp(repository, runner), /expected cluster|context/i);
  assert.equal(calls.some(({ command, args }) => command === "minikube" && args[0] === "start"), false);
});

test("managed environments do not inherit local-only component values", async () => {
  const repository = await loadRepository("managed-example");
  const prometheus = repository.catalog.components.find(({ name }) => name === "prometheus")!;

  assert.deepEqual(helmUpgradeArgs(repository, prometheus).filter((value) => value === "--values"), []);
});

test("manifest components apply nested manifest directories recursively", async () => {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(({ name }) => name === "kore-postgresql-api")!;
  const runner = new RecordingRunner();

  await reconcileComponent(repository, runner, component);

  assert.ok(runner.calls[0]?.args.includes("--recursive"));
});

test("render validation checks manifest components without mutating the cluster", async () => {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(({name}) => name === "kore-postgresql-api")!;
  repository.catalog.components = [{...component, dependencies:[]}];
  const runner = new RecordingRunner();

  await platformRender(repository, runner);

  assert.equal(runner.calls.length, 1);
  assert.equal(runner.calls[0]?.command, "kubectl");
  assert.ok(runner.calls[0]?.args.includes("--dry-run=client"));
  assert.ok(runner.calls[0]?.args.includes("--recursive"));
});

test("platform status reports a failed Helm release as degraded", async () => {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(({name}) => name === "opa-authorizer")!;
  repository.catalog.components = [{...component, dependencies:[]}];
  const runner = new RecordingRunner([{stdout: JSON.stringify({info: {status: {status: "failed"}}}), stderr: "", code: 0}]);

  const [status] = await platformStatus(repository, runner);

  assert.ok(status);
  assert.equal(status.status, "degraded");
  assert.match(status.detail, /failed/i);
});
