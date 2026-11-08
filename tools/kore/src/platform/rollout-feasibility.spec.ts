import assert from "node:assert/strict";
import { test } from "vitest";
import { rolloutProblems } from "./rollout-feasibility.js";

const hostnameAntiAffinity = (labels: Record<string, string>) => ({
  podAntiAffinity: {
    requiredDuringSchedulingIgnoredDuringExecution: [
      {
        labelSelector: { matchLabels: labels },
        topologyKey: "kubernetes.io/hostname",
      },
    ],
  },
});

// The loki chart's gateway: RollingUpdate default (25% surge) plus a required
// hostname anti-affinity against its own pods.
const lokiGateway = {
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "loki-gateway", namespace: "observability" },
  spec: {
    replicas: 1,
    strategy: { type: "RollingUpdate" } as {
      type: string;
      rollingUpdate?: unknown;
    },
    selector: { matchLabels: { "app.kubernetes.io/component": "gateway" } },
    template: {
      metadata: { labels: { "app.kubernetes.io/component": "gateway" } },
      spec: {
        affinity: hostnameAntiAffinity({
          "app.kubernetes.io/component": "gateway",
        }),
        containers: [{ name: "nginx", image: "nginx" }],
      },
    },
  },
};

function workload(overrides: Record<string, unknown>) {
  return structuredClone({ ...lokiGateway, ...overrides });
}

test("a surge pod that cannot leave the old pod's node blocks a rollout on one node", () => {
  const problems = rolloutProblems([lokiGateway], 1);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /Deployment observability\/loki-gateway/);
  assert.match(problems[0]!, /anti-affinity/);
});

test("the same workload is feasible when the environment has a second node", () => {
  assert.deepEqual(rolloutProblems([lokiGateway], 2), []);
});

test("a workload without the anti-affinity rolls out on one node", () => {
  const plain = structuredClone(lokiGateway);
  delete (plain.spec.template.spec as { affinity?: unknown }).affinity;
  assert.deepEqual(rolloutProblems([plain], 1), []);
});

test("maxSurge 0 lets a RollingUpdate replace the pod in place", () => {
  const inPlace = structuredClone(lokiGateway) as typeof lokiGateway & {
    spec: { strategy: unknown };
  };
  inPlace.spec.strategy = {
    type: "RollingUpdate",
    rollingUpdate: { maxSurge: 0, maxUnavailable: 1 },
  };
  assert.deepEqual(rolloutProblems([inPlace], 1), []);
});

test("Recreate never surges, so anti-affinity is harmless to rollout", () => {
  const recreate = structuredClone(lokiGateway) as typeof lokiGateway & {
    spec: { strategy: unknown };
  };
  recreate.spec.strategy = { type: "Recreate" };
  assert.deepEqual(rolloutProblems([recreate], 1), []);
});

test("anti-affinity that selects other pods does not block the rollout", () => {
  const other = structuredClone(lokiGateway);
  other.spec.template.spec.affinity = hostnameAntiAffinity({
    "app.kubernetes.io/component": "backend",
  });
  assert.deepEqual(rolloutProblems([other], 1), []);
});

test("preferred anti-affinity never blocks scheduling", () => {
  const preferred = structuredClone(lokiGateway);
  preferred.spec.template.spec.affinity = {
    podAntiAffinity: {
      preferredDuringSchedulingIgnoredDuringExecution: [
        {
          weight: 100,
          podAffinityTerm: {
            labelSelector: {
              matchLabels: { "app.kubernetes.io/component": "gateway" },
            },
            topologyKey: "kubernetes.io/hostname",
          },
        },
      ],
    },
  } as never;
  assert.deepEqual(rolloutProblems([preferred], 1), []);
});

test("replicas above the node count cannot all schedule under required anti-affinity", () => {
  const statefulSet = workload({
    kind: "StatefulSet",
    spec: { ...lokiGateway.spec, replicas: 3, strategy: undefined },
  });
  const problems = rolloutProblems([statefulSet], 2);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /3 replicas/);
});

test("a DaemonSet with surge and a hostPort collides with its own old pod", () => {
  const daemon = {
    apiVersion: "apps/v1",
    kind: "DaemonSet",
    metadata: { name: "agent", namespace: "observability" },
    spec: {
      updateStrategy: {
        type: "RollingUpdate",
        rollingUpdate: { maxSurge: 1, maxUnavailable: 0 },
      },
      template: {
        spec: {
          containers: [
            {
              name: "agent",
              ports: [{ containerPort: 4317, hostPort: 4317 }],
            },
          ],
        },
      },
    },
  };
  const problems = rolloutProblems([daemon], 1);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /hostPort 4317/);
});

test("a DaemonSet with the default maxSurge 0 replaces hostPort pods in place", () => {
  const daemon = {
    apiVersion: "apps/v1",
    kind: "DaemonSet",
    metadata: { name: "agent", namespace: "observability" },
    spec: {
      template: {
        spec: {
          containers: [{ name: "agent", ports: [{ hostPort: 4317 }] }],
        },
      },
    },
  };
  assert.deepEqual(rolloutProblems([daemon], 1), []);
});

test("a Deployment's default surge cannot reuse a hostPort on a single node", () => {
  const hostPorted = structuredClone(lokiGateway);
  delete (hostPorted.spec.template.spec as { affinity?: unknown }).affinity;
  (hostPorted.spec.template.spec.containers[0] as { ports?: unknown }).ports = [
    { containerPort: 80, hostPort: 8080 },
  ];
  const problems = rolloutProblems([hostPorted], 1);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /hostPort 8080/);
});

const budget = (minAvailable: unknown, labels: Record<string, string>) => ({
  apiVersion: "policy/v1",
  kind: "PodDisruptionBudget",
  metadata: { name: "gateway", namespace: "observability" },
  spec: { minAvailable, selector: { matchLabels: labels } },
});

test("a budget with minAvailable at or above replicas blocks node drains", () => {
  const plain = structuredClone(lokiGateway);
  delete (plain.spec.template.spec as { affinity?: unknown }).affinity;
  const problems = rolloutProblems(
    [plain, budget(1, { "app.kubernetes.io/component": "gateway" })],
    1,
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /PodDisruptionBudget observability\/gateway/);
  assert.match(problems[0]!, /drain/);
});

test("a budget below replicas leaves room to drain", () => {
  const plain = workload({
    spec: { ...lokiGateway.spec, replicas: 2 },
  });
  delete (plain.spec.template.spec as { affinity?: unknown }).affinity;
  assert.deepEqual(
    rolloutProblems(
      [plain, budget(1, { "app.kubernetes.io/component": "gateway" })],
      1,
    ),
    [],
  );
});

test("a budget that selects no workload is ignored", () => {
  assert.deepEqual(rolloutProblems([budget(5, { app: "elsewhere" })], 1), []);
});

test("a budget with maxUnavailable never blocks drains", () => {
  const pdb = budget(undefined, { "app.kubernetes.io/component": "gateway" });
  pdb.spec = { maxUnavailable: 0, selector: pdb.spec.selector } as never;
  assert.deepEqual(rolloutProblems([pdb], 1), []);
});

// The new template drops the rule, but the pods of the release that is
// running still carry it, and anti-affinity is symmetric: the old pod rejects
// a surge pod whose labels it selects.
function withoutAffinity() {
  const next = structuredClone(lokiGateway);
  delete (next.spec.template.spec as { affinity?: unknown }).affinity;
  return next;
}

test("an old pod's required anti-affinity rejects the surge pod even when the new template drops it", () => {
  const problems = rolloutProblems([withoutAffinity()], 1, [lokiGateway]);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /Deployment observability\/loki-gateway/);
  assert.match(problems[0]!, /running pods/);
  assert.match(problems[0]!, /maxSurge/);
});

test("the symmetric case is cleared by maxSurge 0 on one node", () => {
  const inPlace = withoutAffinity() as ReturnType<typeof withoutAffinity> & {
    spec: { strategy: unknown };
  };
  inPlace.spec.strategy = {
    type: "RollingUpdate",
    rollingUpdate: { maxSurge: 0, maxUnavailable: 1 },
  };
  assert.deepEqual(rolloutProblems([inPlace], 1, [lokiGateway]), []);
});

test("the symmetric case needs the old rule to select the new pods", () => {
  const unrelated = structuredClone(lokiGateway);
  unrelated.spec.template.spec.affinity = hostnameAntiAffinity({
    "app.kubernetes.io/component": "backend",
  });
  assert.deepEqual(rolloutProblems([withoutAffinity()], 1, [unrelated]), []);
});

test("the symmetric case is moot with a second node or no previous release", () => {
  assert.deepEqual(rolloutProblems([withoutAffinity()], 2, [lokiGateway]), []);
  assert.deepEqual(rolloutProblems([withoutAffinity()], 1, []), []);
});

test("a workload that keeps the rule is reported once, not twice", () => {
  assert.equal(rolloutProblems([lokiGateway], 1, [lokiGateway]).length, 1);
});
