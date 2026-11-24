import assert from "node:assert/strict";
import { test } from "vitest";
import {
  loadRepository,
  nodeCount,
  type Repository,
} from "../../src/config/index.js";
import { render } from "./gateway-service-support.js";

// Docs: docs/decisions/0154-workloads-run-two-replicas-roll-out-one-surge-pod-at-a-time-and-keep-a-disruption-budget.md
// The shared gateway proxy gets the app defaults behind gateway-proxy-defaults:
// two replicas, one surge pod with no unavailable, the readiness gate's
// minReadySeconds and progressDeadlineSeconds, and a PodDisruptionBudget. Off,
// the render is the one it was before.

function withProxyDefaults(repository: Repository, on: boolean): Repository {
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        "gateway-proxy-defaults": on,
      },
    },
  };
}

const rolling =
  /strategy:\s+type: RollingUpdate\s+rollingUpdate:\s+maxUnavailable: 0\s+maxSurge: 1/;
const readinessGate = /minReadySeconds: 10\s+progressDeadlineSeconds: 600/;
const budget =
  /kind: PodDisruptionBudget\s+metadata:\s+name: kore-gateway-proxy\s+namespace: kore-system[\s\S]*?maxUnavailable: 1\s+selector:\s+matchLabels:\s+gateway\.networking\.k8s\.io\/gateway-name: kore-gateway/;

test("flag off: the Istio class renders no proxy defaults and no budget, as before", async () => {
  const output = render(withProxyDefaults(await loadRepository("vps"), false));
  assert.doesNotMatch(output, /deployment: \|/);
  assert.doesNotMatch(output, /replicas:/);
  assert.doesNotMatch(output, /PodDisruptionBudget/);
  assert.doesNotMatch(output, /parametersRef/);
});

test("flag on, Istio class: the Gateway's ConfigMap carries the rollout and readiness gate, and the proxy has a budget", async () => {
  const repository = withProxyDefaults(await loadRepository("vps"), true);
  const output = render(repository);
  // The vps overlay publishes no Service, so the ConfigMap carries only the
  // deployment overlay; the Gateway points at it.
  assert.match(
    output,
    /parametersRef: \{group: "", kind: ConfigMap, name: kore-gateway-service\}/,
  );
  assert.match(output, /deployment: \|\s+spec:\s+replicas: 2/);
  assert.match(output, rolling);
  assert.match(output, readinessGate);
  assert.doesNotMatch(output, /service: \|/);
  assert.match(output, budget);
});

test("flag on, agentgateway class: the overlay keeps its Service and gains the proxy defaults", async () => {
  // The local overlay runs agentgateway and publishes a NodePort Service.
  const repository = withProxyDefaults(await loadRepository("local"), true);
  const output = render(repository);
  assert.match(
    output,
    /parametersRef: \{group: agentgateway\.dev, kind: AgentgatewayParameters, name: kore-gateway-service\}/,
  );
  assert.match(output, /kind: AgentgatewayParameters[\s\S]*?spec:\s+service:/);
  assert.match(output, /type: NodePort/);
  assert.match(output, /deployment:\s+spec:\s+replicas: 2/);
  assert.match(output, rolling);
  assert.match(output, readinessGate);
  assert.match(output, budget);
});

test("the proxy keeps two replicas on the environment's declared node count", async () => {
  for (const name of ["local", "vps", "managed-example"]) {
    const repository = withProxyDefaults(await loadRepository(name), true);
    const nodes = nodeCount(repository.environment);
    const output = render(repository);
    assert.match(output, /replicas: 2/, `${name} on ${nodes} declared node(s)`);
    assert.match(output, budget, `${name} on ${nodes} declared node(s)`);
  }
});
