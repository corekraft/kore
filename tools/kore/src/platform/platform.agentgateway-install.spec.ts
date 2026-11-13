import assert from "node:assert/strict";
import { test, vi } from "vitest";

vi.mock("../images/index.js", () => ({
  ensureLocalSigningPublicKey: async () => undefined,
  ensureRegistryAuth: async () => undefined,
  ensureRegistryTrust: async () => undefined,
  registryTrustProblem: async () => undefined,
}));
vi.mock("./admission-gate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./admission-gate.js")>()),
  closeExistingAdmissionGate: async () => undefined,
}));
vi.mock("./registry-rewire.js", () => ({
  rewireRegistryService: async () => false,
}));
import { CommandError, type Runner } from "../runtime/index.js";
import {
  agentgateway,
  cluster,
  component,
  local,
  upgrades,
} from "./agentgateway-fixtures.js";
import { bootstrapControllers } from "./bootstrap.js";
import { reconcileComponent } from "./reconcile.js";
import { crashLoop, pod, Scenario } from "./fail-fast-fixtures.js";

test("with the flag off, bootstrap issues no agentgateway command beyond the release probe", async () => {
  const repository = await local(false);
  const { runner, calls } = cluster(repository, false);
  await bootstrapControllers(repository, runner);
  assert.ok(upgrades(calls).length > 0, "the rest of the platform installs");
  assert.deepEqual(
    calls
      .map((c) => c.replaceAll(repository.root, "<root>"))
      .filter((c) => agentgateway.test(c) && !c.startsWith("helm status ")),
    [],
  );
});

test("with the flag on, the CRDs install before the controller, after their dependencies", async () => {
  const repository = await local(true);
  const { runner, calls } = cluster(repository, false);
  await bootstrapControllers(repository, runner);
  const order = upgrades(calls);
  const at = (name: string) => order.indexOf(name);
  assert.ok(at("agentgateway-crds") >= 0 && at("agentgateway") >= 0);
  const gatewayApi = calls.findIndex(
    (c) =>
      c.startsWith("kubectl") &&
      c.includes(" apply ") &&
      c.includes("standard-install.yaml"),
  );
  const crdsInstall = calls.findIndex((c) =>
    c.startsWith("helm upgrade --install agentgateway-crds "),
  );
  assert.ok(gatewayApi >= 0, "the kore-gateway-api manifest is applied");
  assert.ok(
    gatewayApi < crdsInstall,
    "the Gateway API CRDs are applied before the agentgateway CRDs",
  );
  assert.ok(at("agentgateway-crds") < at("agentgateway"));
  assert.ok(at("cert-manager") < at("agentgateway"));
});

test("the controller install waits for its Deployment, and the CRDs wait for the CRDs", async () => {
  const repository = await local(true);
  const { runner, calls } = cluster(repository, false);
  await bootstrapControllers(repository, runner);
  const install = calls.findIndex((c) =>
    c.startsWith("helm upgrade --install agentgateway "),
  );
  assert.ok(install >= 0);
  const after = calls.slice(install + 1);
  assert.ok(
    after.some(
      (c) =>
        c.includes("rollout status") &&
        c.includes("deployment/agentgateway") &&
        c.includes("--namespace agentgateway-system"),
    ),
    "readiness waits for the rollout of deployment/agentgateway in agentgateway-system",
  );
  const crds = calls.findIndex((c) =>
    c.startsWith("helm upgrade --install agentgateway-crds "),
  );
  assert.ok(
    calls
      .slice(crds + 1, install)
      .some((c) => c.includes("agentgatewaypolicies.agentgateway.dev")),
    "the CRDs are established before the controller installs",
  );
});

test("rerunning bootstrap on a converged cluster changes no Helm release", async () => {
  const repository = await local(true);
  const { runner, calls } = cluster(repository, true);
  await bootstrapControllers(repository, runner);
  assert.deepEqual(upgrades(calls), []);
  assert.deepEqual(
    calls.filter((c) => /^helm (uninstall|rollback)/.test(c)),
    [],
  );
});

test("an unready agentgateway controller names the pod and container, never a bare timeout", async () => {
  const repository = await local(true);
  const target = component(repository, "agentgateway");
  const scenario = new Scenario(() => [
    pod({
      name: "agentgateway-x",
      labels: { "app.kubernetes.io/instance": "agentgateway" },
      containers: [{ ...crashLoop(3), name: "controller" }],
    }),
  ]);
  await assert.rejects(
    reconcileComponent(repository, scenario, target, {
      clock: scenario.clock,
      intervalMs: 5000,
      graceMs: 60000,
    }),
    (error: Error) =>
      /component agentgateway failed: pod agentgateway-x container controller CrashLoopBackOff/.test(
        error.message,
      ) && !/timed out/i.test(error.message),
  );
  assert.equal(scenario.aborts, 1, "helm is cancelled, not waited out");
});

test("a failed agentgateway Helm install names the component and Helm's own error", async () => {
  const repository = await local(true);
  const target = component(repository, "agentgateway");
  const runner: Runner = {
    async run(command, args) {
      if (command === "helm" && args[0] === "upgrade") {
        throw new CommandError(command, args, {
          stdout: "",
          stderr: "Error: INSTALLATION FAILED: manifest unreachable",
          code: 1,
        });
      }
      return { stdout: "[]", stderr: "", code: 0 };
    },
  };
  await assert.rejects(
    reconcileComponent(repository, runner, target),
    /component agentgateway failed to become ready: .*manifest unreachable/s,
  );
});
