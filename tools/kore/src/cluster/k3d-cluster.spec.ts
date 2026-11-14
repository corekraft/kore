import { beforeEach, expect, test, vi } from "vitest";
import {
  k3dTrustDirectory,
  k3dTrustVolumeArgs,
  koreManagesRegistryAuth,
  registryAddress,
  writeK3dRegistriesConfig,
} from "../images/index.js";
import type { Runner } from "../runtime/index.js";
import { CommandError } from "../runtime/index.js";
import { ClusterUnavailableError } from "./cluster-unavailable.js";
import { waitForClusterReady } from "./readiness.js";
import {
  assertExpectedK3dCluster,
  clusterStatusK3d,
  clusterUpK3d,
  k3dClusterInfo,
  k3dCreateArgs,
  listOrUnavailable,
  runK3d,
} from "./k3d-cluster.js";
import {
  commandLines,
  fakeK3d,
  fakeRepository,
  fakeRunner,
  k3dEntry,
} from "./cluster-support.js";
import {
  createArgs,
  LIST,
  MESSAGES,
  NAMESPACE_CHECK,
  RUNNING_STATUS,
  TRUST,
  TRUST_VOLUMES,
} from "./k3d-cluster-support.js";

vi.mock("../images/index.js");
vi.mock("./readiness.js");

const READINESS = { timeoutMs: 1000 };
const repository = fakeRepository();

beforeEach(() => {
  vi.mocked(k3dTrustDirectory).mockReturnValue(TRUST);
  vi.mocked(k3dTrustVolumeArgs).mockReturnValue(TRUST_VOLUMES);
  vi.mocked(koreManagesRegistryAuth).mockReturnValue(true);
  vi.mocked(registryAddress).mockReturnValue("10.96.0.50:5000");
  vi.mocked(writeK3dRegistriesConfig).mockResolvedValue(undefined);
  vi.mocked(waitForClusterReady).mockResolvedValue(undefined);
});

const up = (runner: Runner, env = repository) =>
  clusterUpK3d(env, runner, READINESS, "/home/u");

test("a k3d create pins the k3s image, disables the bundled ingress and load balancer, and mounts the registry trust", () => {
  expect(k3dCreateArgs(repository, TRUST)).toEqual(createArgs());
  expect(k3dTrustVolumeArgs).toHaveBeenCalledWith(TRUST);
});

test("a k3d create for an external registry mounts no trust and names no registry flag", () => {
  vi.mocked(koreManagesRegistryAuth).mockReturnValue(false);
  expect(k3dCreateArgs(repository, TRUST)).toEqual(createArgs([]));
  expect(k3dTrustVolumeArgs).not.toHaveBeenCalled();
});

test("a k3d create refuses an unpinned k3s image, and an environment with no k3d settings, naming the fix", () => {
  expect(() =>
    k3dCreateArgs(fakeRepository({}, { images: {} }), TRUST),
  ).toThrow(MESSAGES.unpinned);
  expect(() =>
    k3dCreateArgs(fakeRepository({ k3d: undefined }), TRUST),
  ).toThrow(MESSAGES.noSettings);
});

test("the cluster list is read as JSON through k3d, the entry is found by its name, and a cluster not in the list is absent", async () => {
  const list = JSON.stringify([k3dEntry(0, { name: "other" }), k3dEntry(1)]);
  const { runner, run } = fakeRunner(() => list);
  const info = await k3dClusterInfo(repository.environment, runner);
  expect(commandLines(run)).toEqual([LIST]);
  expect(info.state).toBe("running");
  expect(info.entry?.["name"]).toBe("kore-local");
  const none = fakeRunner(() => "[]");
  expect(await k3dClusterInfo(repository.environment, none.runner)).toEqual({
    state: "absent",
  });
});

test("a cluster whose servers or agents are not all running is stopped, not running", async () => {
  for (const overrides of [
    { serversCount: 3, serversRunning: 2 },
    { agentsCount: 2, agentsRunning: 1 },
  ]) {
    const { runner } = fakeRunner(() =>
      JSON.stringify([k3dEntry(1, overrides)]),
    );
    expect((await k3dClusterInfo(repository.environment, runner)).state).toBe(
      "stopped",
    );
  }
});

test("unreadable list output, or JSON that is not a list, is named and never mistaken for an absent cluster", async () => {
  const garbled = fakeRunner(() => "not json");
  await expect(
    k3dClusterInfo(repository.environment, garbled.runner),
  ).rejects.toThrow(MESSAGES.unreadable);
  const object = fakeRunner(() => "{}");
  await expect(
    k3dClusterInfo(repository.environment, object.runner),
  ).rejects.toThrow(MESSAGES.notList);
});

test("a k3d binary that cannot be spawned raises the unavailable error with the install remedy, while a k3d command that runs and fails is raised as it is", async () => {
  const spawn = Object.assign(new Error("spawn k3d ENOENT"), {
    code: "ENOENT",
  });
  const missing = fakeRunner(() => {
    throw spawn;
  });
  const error: unknown = await runK3d(
    missing.runner,
    ["cluster", "list"],
    {},
  ).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ClusterUnavailableError);
  expect((error as Error).message).toMatch(MESSAGES.install);
  expect((error as Error).cause).toBe(spawn);
  const failure = new CommandError("k3d", ["cluster", "list"], {
    stdout: "",
    stderr: "boom",
    code: 1,
  });
  const failing = fakeRunner(() => {
    throw failure;
  });
  await expect(runK3d(failing.runner, ["cluster", "list"], {})).rejects.toBe(
    failure,
  );
});

test("a failing cluster list is unavailable with the install remedy, while any other failure is raised as it is", async () => {
  const failing = new CommandError("k3d", ["cluster", "list"], {
    stdout: "",
    stderr: "docker not running",
    code: 1,
  });
  const first = fakeRunner(() => {
    throw failing;
  });
  await expect(
    listOrUnavailable(repository.environment, first.runner),
  ).rejects.toThrow(MESSAGES.unavailable);
  const other = new Error("boom");
  const second = fakeRunner(() => {
    throw other;
  });
  await expect(
    listOrUnavailable(repository.environment, second.runner),
  ).rejects.toBe(other);
});

test("a configured context that is not the one k3d names is refused before any command runs, in both the up and the expected-cluster check", async () => {
  const other = fakeRepository({ kubeContext: "other-context" });
  const check = fakeRunner();
  await expect(assertExpectedK3dCluster(other, check.runner)).rejects.toThrow(
    MESSAGES.contextRefused,
  );
  expect(check.run).not.toHaveBeenCalled();
  const production = fakeK3d(undefined);
  await expect(
    up(production.runner, fakeRepository({ kubeContext: "production" })),
  ).rejects.toThrow(MESSAGES.productionRefused);
  expect(production.run).not.toHaveBeenCalled();
});

test("a stopped or absent cluster is unavailable from the expected-cluster check and from status, naming the way to start it", async () => {
  const stopped = fakeK3d(0).runner;
  await expect(assertExpectedK3dCluster(repository, stopped)).rejects.toThrow(
    MESSAGES.stopped,
  );
  await expect(clusterStatusK3d(repository, stopped)).rejects.toThrow(
    MESSAGES.stopped,
  );
  const absent = fakeK3d(undefined).runner;
  await expect(assertExpectedK3dCluster(repository, absent)).rejects.toThrow(
    MESSAGES.absent,
  );
  await expect(clusterStatusK3d(repository, absent)).rejects.toThrow(
    MESSAGES.absent,
  );
});

test("a running cluster is checked through its configured context, and it is not the expected cluster when kube-system answers with another name", async () => {
  const { runner, run } = fakeK3d(1);
  await assertExpectedK3dCluster(repository, runner);
  expect(commandLines(run)).toEqual([LIST, NAMESPACE_CHECK]);
  const other = fakeK3d(1, {}, "default");
  await expect(
    assertExpectedK3dCluster(repository, other.runner),
  ).rejects.toThrow(MESSAGES.wrongNamespace);
});

test("an absent cluster has its registry file written first, is created with the pinned arguments, then awaited for readiness and identity-checked", async () => {
  const { runner, run } = fakeK3d(undefined);
  await up(runner);
  expect(k3dTrustDirectory).toHaveBeenCalledWith("kore-local", "/home/u");
  expect(writeK3dRegistriesConfig).toHaveBeenCalledWith(
    TRUST,
    "10.96.0.50:5000",
  );
  expect(commandLines(run)).toEqual([
    LIST,
    `k3d ${createArgs().join(" ")}`,
    LIST,
    NAMESPACE_CHECK,
  ]);
  expect(run.mock.calls[1]?.[2]).toEqual({ capture: false, cwd: "/repo" });
  expect(waitForClusterReady).toHaveBeenCalledWith(
    repository,
    runner,
    READINESS,
  );
  const order = {
    write: vi.mocked(writeK3dRegistriesConfig).mock.invocationCallOrder[0] ?? 0,
    create: run.mock.invocationCallOrder[1] ?? 0,
    ready: vi.mocked(waitForClusterReady).mock.invocationCallOrder[0] ?? 0,
  };
  expect(order.write).toBeLessThan(order.create);
  expect(order.ready).toBeGreaterThan(order.create);
});

test("a stopped cluster is started, not created, after the registry file is written; a running one is neither", async () => {
  const stopped = fakeK3d(0);
  await up(stopped.runner);
  expect(commandLines(stopped.run)).toEqual([
    LIST,
    "k3d cluster start kore-local --wait --timeout 300s",
    LIST,
    NAMESPACE_CHECK,
  ]);
  expect(
    vi.mocked(writeK3dRegistriesConfig).mock.invocationCallOrder[0],
  ).toBeLessThan(stopped.run.mock.invocationCallOrder[1] ?? 0);
  const running = fakeK3d(1);
  await up(running.runner);
  expect(commandLines(running.run)).toEqual([LIST, LIST, NAMESPACE_CHECK]);
  expect(writeK3dRegistriesConfig).toHaveBeenCalledTimes(1);
});

test("an external registry creates the cluster with no trust mounts and writes no registry file", async () => {
  vi.mocked(koreManagesRegistryAuth).mockReturnValue(false);
  const { runner, run } = fakeK3d(undefined);
  await up(runner);
  expect(commandLines(run)[1]).toBe(`k3d ${createArgs([]).join(" ")}`);
  expect(writeK3dRegistriesConfig).not.toHaveBeenCalled();
});

test("drift is refused with the recreate path before any start or write, when servers differ or a published port is not the overlay's host port", async () => {
  const servers = fakeK3d(1, { serversCount: 3, serversRunning: 3 });
  await expect(up(servers.runner)).rejects.toThrow(MESSAGES.overlayServers);
  expect(commandLines(servers.run)).toEqual([LIST]);
  const nodes = (ports: Record<string, { HostPort: string }[]>) => [
    { role: "loadbalancer", portMappings: ports },
  ];
  const wrong = fakeK3d(1, {
    nodes: nodes({ "443/tcp": [{ HostPort: "9443" }] }),
  });
  await expect(up(wrong.runner)).rejects.toThrow(MESSAGES.wrongPort);
  const unmapped = fakeK3d(1, { nodes: nodes({ "443/tcp": [] }) });
  await expect(up(unmapped.runner)).rejects.toThrow(MESSAGES.unmappedPort);
  expect(writeK3dRegistriesConfig).not.toHaveBeenCalled();
  expect(waitForClusterReady).not.toHaveBeenCalled();
});

test("an extra load-balancer mapping such as the random API port is not drift", async () => {
  const extra = fakeK3d(1, {
    nodes: [
      {
        role: "loadbalancer",
        portMappings: {
          "443/tcp": [{ HostPort: "8443" }],
          "6443/tcp": [{ HostPort: "51234" }],
        },
      },
    ],
  });
  await up(extra.runner);
  expect(waitForClusterReady).toHaveBeenCalledTimes(1);
});

test("a readiness failure after create is raised as it is, and the identity check is never reached", async () => {
  vi.mocked(waitForClusterReady).mockRejectedValue(new Error("not ready"));
  const { runner, run } = fakeK3d(undefined);
  await expect(up(runner)).rejects.toThrow("not ready");
  expect(commandLines(run)).toEqual([LIST, `k3d ${createArgs().join(" ")}`]);
});

test("a status reports the cluster, context, environment and state, with only the counts from k3d's entry", async () => {
  const status = await clusterStatusK3d(repository, fakeK3d(1).runner);
  expect(status).toEqual({ environment: "local", ...RUNNING_STATUS });
  expect(JSON.stringify(status)).not.toContain("SECRET-TOKEN");
});
