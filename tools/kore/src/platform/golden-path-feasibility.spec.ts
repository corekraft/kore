// Docs: docs/decisions/0036-rollout-feasibility-and-container-smoke.md
import { expect, test, vi } from "vitest";
import type { Environment } from "../config/index.js";
import { goldenPathFeasibility } from "./golden-path-feasibility.live.js";

// Docs: docs/decisions/0154-workloads-run-two-replicas-roll-out-one-surge-pod-at-a-time-and-keep-a-disruption-budget.md
// The flag-on golden render: two replicas per workload, RollingUpdate with one
// surge pod and no unavailable pod, and a PodDisruptionBudget of maxUnavailable 1.
// The renderer is mocked here; the opt-in spec renders the real chart.

const environment = (fields: Partial<Environment> = {}) =>
  ({ name: "local", provider: "k3d", ...fields }) as Environment;

const image = `ghcr.io/corekraft/kore/kotlin-bff-template@sha256:${"b".repeat(64)}`;

function deployment(
  name: string,
  spec: Record<string, unknown> = {},
  podSpec: Record<string, unknown> = {},
) {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name, labels: { "app.kubernetes.io/part-of": "auth" } },
    spec: {
      replicas: 2,
      minReadySeconds: 10,
      progressDeadlineSeconds: 600,
      strategy: {
        type: "RollingUpdate",
        rollingUpdate: { maxSurge: 1, maxUnavailable: 0 },
      },
      selector: { matchLabels: { "app.kubernetes.io/name": name } },
      template: {
        metadata: { labels: { "app.kubernetes.io/name": name } },
        spec: {
          containers: [
            {
              name: "bff",
              image,
              ports: [{ name: "http", containerPort: 8080 }],
            },
          ],
          ...podSpec,
        },
      },
      ...spec,
    },
  };
}

function budget(name: string, spec: Record<string, unknown>) {
  return {
    apiVersion: "policy/v1",
    kind: "PodDisruptionBudget",
    metadata: { name },
    spec: {
      selector: { matchLabels: { "app.kubernetes.io/name": name } },
      ...spec,
    },
  };
}

const flagOnRender = () => [
  deployment("auth-bff"),
  deployment("auth-frontend"),
  budget("auth-bff", { maxUnavailable: 1 }),
  budget("auth-frontend", { maxUnavailable: 1 }),
];

const hostnameAntiAffinity = {
  affinity: {
    podAntiAffinity: {
      requiredDuringSchedulingIgnoredDuringExecution: [
        {
          labelSelector: {
            matchLabels: { "app.kubernetes.io/name": "auth-bff" },
          },
          topologyKey: "kubernetes.io/hostname",
        },
      ],
    },
  },
};

test("the flag-on golden render passes on the default one node, with no rollout problem", async () => {
  const render = vi.fn(async () => flagOnRender());

  await expect(goldenPathFeasibility(environment(), render)).resolves.toEqual(
    [],
  );
});

test("the declared node count decides: a workload that needs its own node per pod fails on one node and passes on two", async () => {
  const bff = deployment(
    "auth-bff",
    {
      replicas: 2,
      strategy: {
        type: "RollingUpdate",
        rollingUpdate: { maxSurge: 0, maxUnavailable: 1 },
      },
    },
    hostnameAntiAffinity,
  );
  const render = vi.fn(async () => [bff]);

  const onOne = await goldenPathFeasibility(environment(), render);
  expect(onOne).toHaveLength(1);
  expect(onOne[0]).toMatch(/Deployment auth-bff/);

  await expect(
    goldenPathFeasibility(environment({ nodeCount: 2 }), render),
  ).resolves.toEqual([]);
});

test("an environment that declares no node count is judged on one node, as local is", async () => {
  const bff = deployment(
    "auth-bff",
    {
      strategy: {
        type: "RollingUpdate",
        rollingUpdate: { maxSurge: 0, maxUnavailable: 1 },
      },
    },
    hostnameAntiAffinity,
  );

  const problems = await goldenPathFeasibility(environment(), async () => [
    bff,
  ]);

  expect(problems.join("\n")).toMatch(
    /has 2 replicas but the environment has 1 node/,
  );
});

test("a hostname anti-affinity against its own pods fails naming the workload when the rollout's peak exceeds the declared nodes", async () => {
  const bff = deployment("auth-bff", {}, hostnameAntiAffinity);
  const problems = await goldenPathFeasibility(
    environment({ nodeCount: 2 }),
    async () => [bff],
  );

  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatch(/^Deployment auth-bff: /);
  expect(problems[0]).toMatch(/anti-affinity/);
});

test("a host port fails naming the workload when its rollout needs more nodes than the environment declares", async () => {
  const frontend = deployment(
    "auth-frontend",
    {},
    {
      containers: [
        {
          name: "frontend",
          image,
          ports: [{ name: "http", containerPort: 8080, hostPort: 8080 }],
        },
      ],
    },
  );

  const onOne = await goldenPathFeasibility(environment(), async () => [
    frontend,
  ]);
  expect(onOne).toHaveLength(1);
  expect(onOne[0]).toMatch(/^Deployment auth-frontend: /);
  expect(onOne[0]).toMatch(/hostPort 8080/);

  await expect(
    goldenPathFeasibility(environment({ nodeCount: 3 }), async () => [
      frontend,
    ]),
  ).resolves.toEqual([]);
});

test("a PodDisruptionBudget whose minAvailable covers every replica fails naming the workload, on any node count", async () => {
  const render = async () => [
    deployment("auth-bff"),
    budget("auth-bff", { minAvailable: 2 }),
  ];

  for (const nodes of [1, 2, 5]) {
    const problems = await goldenPathFeasibility(
      environment({ nodeCount: nodes }),
      render,
    );
    expect(problems, `${nodes} node(s)`).toHaveLength(1);
    expect(problems[0]).toMatch(/PodDisruptionBudget auth-bff/);
    expect(problems[0]).toMatch(/Deployment auth-bff/);
  }
});

test("a render that fails is not reported as feasible", async () => {
  const render = vi.fn(async () => {
    throw new Error("helm template failed");
  });

  await expect(goldenPathFeasibility(environment(), render)).rejects.toThrow(
    "helm template failed",
  );
});
