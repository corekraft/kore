import { expect, test } from "vitest";
import type { Runner } from "../runtime/index.js";
import { CommandError } from "../runtime/index.js";
import {
  assertExpectedCluster,
  ClusterUnavailableError,
  clusterStatus,
  clusterUp,
} from "./cluster.js";
import {
  fakeRunner,
  fast,
  k3dRepository,
  ok,
  testHome,
  text,
  trustVolumeArgs,
} from "../testing/index.js";

const create = [
  "k3d cluster create kore-local --image rancher/k3s:v1.37.2-k3s1@sha256:21ea6e0fac4e3930c2ce8aa40ddd41a8b18cb3e9a0222c030dc005e7e88c4332 --servers 1 --agents 0 --k3s-arg --disable=traefik@server:* --k3s-arg --disable=servicelb@server:* --k3s-arg --service-cidr=10.96.0.0/12@server:* --port 8443:443@loadbalancer",
  ...trustVolumeArgs(),
  "--kubeconfig-update-default=true --kubeconfig-switch-context=false --wait --timeout 300s",
].join(" ");
const readiness = [
  "kubectl --context k3d-kore-local get --raw /readyz",
  expect.stringContaining("kubectl --context k3d-kore-local get nodes -o"),
];
const checkNamespace =
  "kubectl --context k3d-kore-local get namespace kube-system -o jsonpath={.metadata.name}";
const listCommand = "k3d cluster list --output json";

test("cluster up issues exactly this ordered command list when the cluster is absent", async () => {
  const { runner, calls } = fakeRunner(undefined);
  await clusterUp(await k3dRepository(), runner, fast, testHome);
  expect(text(calls)).toEqual([
    listCommand,
    create,
    ...readiness,
    listCommand,
    checkNamespace,
  ]);
});

test("cluster up issues exactly this ordered command list when the cluster is stopped", async () => {
  const { runner, calls } = fakeRunner(0);
  await clusterUp(await k3dRepository(), runner, fast, testHome);
  expect(text(calls)).toEqual([
    listCommand,
    "k3d cluster start kore-local --wait --timeout 300s",
    ...readiness,
    listCommand,
    checkNamespace,
  ]);
});

test("cluster up issues exactly this ordered command list when the cluster is running", async () => {
  const { runner, calls } = fakeRunner(1);
  await clusterUp(await k3dRepository(), runner, fast, testHome);
  expect(text(calls)).toEqual([
    listCommand,
    ...readiness,
    listCommand,
    checkNamespace,
  ]);
});

test("status reports only counts from the k3d entry and never its join token", async () => {
  const { runner } = fakeRunner(1);
  const status = await clusterStatus(await k3dRepository(), runner);
  expect(JSON.stringify(status)).not.toContain("SECRET-TOKEN");
  expect(status["status"]).toEqual({
    serversCount: 1,
    serversRunning: 1,
    agentsCount: 0,
    agentsRunning: 0,
    hasLoadBalancer: true,
  });
});

test("a cluster with some nodes stopped is stopped, so up starts it", async () => {
  for (const overrides of [
    { serversCount: 3, serversRunning: 2 },
    { agentsCount: 2, agentsRunning: 1 },
  ]) {
    const repository = await k3dRepository();
    const { runner, calls } = fakeRunner(1, false, overrides);
    const { environment } = repository;
    const matching = {
      ...repository,
      environment: {
        ...environment,
        k3d: {
          ...environment.k3d!,
          servers: Number(overrides["serversCount"] ?? 1),
          agents: Number(overrides["agentsCount"] ?? 0),
        },
      },
    };
    await clusterUp(matching, runner, fast, testHome);
    expect(text(calls)).toContain(
      "k3d cluster start kore-local --wait --timeout 300s",
    );
  }
});

test("an existing cluster that differs from the overlay fails naming the recreate path before any start", async () => {
  const repository = await k3dRepository();
  for (const [overrides, mentions] of [
    [{ serversCount: 3, serversRunning: 3 }, /servers: 3 != 1/],
    [{ agentsCount: 2, agentsRunning: 2 }, /agents: 2 != 0/],
    [
      {
        nodes: [
          {
            role: "loadbalancer",
            portMappings: { "443/tcp": [{ HostPort: "9443" }] },
          },
        ],
      },
      /port 443: 9443 != 8443/,
    ],
    [
      {
        nodes: [{ role: "loadbalancer", portMappings: { "6443/tcp": [] } }],
      },
      /port 443: unmapped != 8443/,
    ],
  ] as const) {
    for (const running of [0, 1]) {
      const { runner, calls } = fakeRunner(running, false, overrides);
      const error: unknown = await clusterUp(
        repository,
        runner,
        fast,
        testHome,
      ).catch((caught: unknown) => caught);
      expect((error as Error).message).toMatch(mentions);
      expect((error as Error).message).toMatch(
        /kore local down --prune.*kore local up/s,
      );
      expect(text(calls)).toEqual([listCommand]);
    }
  }
});

test("extra load-balancer mappings such as the random API port do not count as drift", async () => {
  const { runner, calls } = fakeRunner(1, false, {
    nodes: [
      {
        role: "loadbalancer",
        portMappings: {
          "443/tcp": [{ HostPort: "8443" }],
          "6443/tcp": [{ HostPort: "51234" }],
        },
        args: ["--service-cidr=10.43.0.0/16"],
      },
      { role: "server", args: ["--service-cidr=10.43.0.0/16"] },
    ],
  });
  await clusterUp(await k3dRepository(), runner, fast, testHome);
  expect(text(calls).some((line) => line.includes("get --raw /readyz"))).toBe(
    true,
  );
});

test("a missing k3d binary raises the unavailable error telling the person to install k3d", async () => {
  const repository = await k3dRepository();
  const runner: Runner = {
    async run() {
      throw Object.assign(new Error("spawn k3d ENOENT"), { code: "ENOENT" });
    },
  };
  for (const act of [
    () => clusterUp(repository, runner, fast, testHome),
    () => clusterStatus(repository, runner),
    () => assertExpectedCluster(repository, runner),
  ]) {
    const error: unknown = await act().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ClusterUnavailableError);
    expect((error as Error).message).toMatch(/install k3d/);
  }
});

test("a k3d create that cannot spawn raises the install error too", async () => {
  const repository = await k3dRepository();
  const runner: Runner = {
    async run(command, args) {
      if (args[1] === "list") {
        return ok("[]");
      }
      throw Object.assign(new Error(`spawn ${command} ENOENT`), {
        code: "ENOENT",
      });
    },
  };
  await expect(
    clusterUp(repository, runner, fast, testHome),
  ).rejects.toBeInstanceOf(ClusterUnavailableError);
});

test("a failing k3d list on the up path is the unavailable error, not a raw command error", async () => {
  const repository = await k3dRepository();
  const runner: Runner = {
    async run(command, args) {
      throw new CommandError(command, args, {
        stdout: "",
        stderr: "docker not running",
        code: 1,
      });
    },
  };
  await expect(
    clusterUp(repository, runner, fast, testHome),
  ).rejects.toBeInstanceOf(ClusterUnavailableError);
});
