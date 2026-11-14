// Docs: infra/plans/14-test-tiers.md#step-2-pilots
import { statfs } from "node:fs/promises";
import { cpus, totalmem, type CpuInfo } from "node:os";
import { beforeEach, expect, test, vi } from "vitest";
import { k3dClusterInfo } from "../cluster/index.js";
import { managedCluster } from "../config/index.js";
import {
  doctor,
  doctorFailed,
  type Check,
  type CheckStatus,
} from "./doctor.js";
import { errno, fakeRepository, fakeRunner } from "./diagnostics-support.js";

vi.mock("node:fs/promises");
vi.mock("node:os");
// Factories name only what doctor reads, so the real barrels never load.
vi.mock("../cluster/index.js", () => ({ k3dClusterInfo: vi.fn() }));
vi.mock("../config/index.js", () => ({ managedCluster: vi.fn() }));

const tools: Record<string, string> = {
  node: "22.11.0",
  npm: "10.9.0",
  kubectl: "1.31.0",
  helm: "3.16.0",
  sops: "3.9.0",
  docker: "27.3.1",
  cosign: "2.4.1",
};
const managedNames = [
  "tool:node",
  "tool:npm",
  "tool:kubectl",
  "tool:helm",
  "tool:sops",
  "tool:docker",
  "tool:cosign",
  "container-runtime",
  "host:cpu",
  "host:memory",
  "host:disk",
  "credentials",
];

const byName = (checks: Check[], name: string) =>
  checks.find((check) => check.name === name);

const reported = (
  name: string,
  status: CheckStatus,
  required: boolean,
  message: string,
): Check => ({ name, status, required, message });

// Pinned versions, except commands keyed `command first-argument` in `overrides`.
function replies(overrides: Record<string, string | Error> = {}) {
  return fakeRunner((command, args) => {
    const key = `${command} ${args[0] ?? ""}`.trim();
    const reply: string | Error | undefined = overrides[key];
    if (reply instanceof Error) {
      throw reply;
    }
    return reply ?? `v${tools[command] ?? "0.0.0"}`;
  });
}

const managedEnvironment = {
  name: "managed-example",
  provider: "managed",
  kubeContext: "prod",
};
const managed = (environment: Record<string, unknown> = {}) =>
  fakeRepository({ ...managedEnvironment, ...environment }, tools);

/** `cpus()` is only read for its length, so each entry is an empty stand-in. */
const cpuList = (count: number): CpuInfo[] =>
  Array.from({ length: count }, () => ({}) as CpuInfo);

const clusterState = (state: "running" | "stopped" | "absent") =>
  ({ state }) as Awaited<ReturnType<typeof k3dClusterInfo>>;

const freeDisk = (gib: number) =>
  ({ bavail: gib, bsize: 1024 ** 3 }) as Awaited<ReturnType<typeof statfs>>;

beforeEach(() => {
  vi.mocked(cpus).mockReturnValue(cpuList(8));
  vi.mocked(totalmem).mockReturnValue(16 * 1024 ** 3);
  vi.mocked(statfs).mockResolvedValue(freeDisk(200));
  vi.mocked(managedCluster).mockReturnValue({
    cpus: 4,
    memoryMB: 8192,
    diskSize: "100g",
  } as ReturnType<typeof managedCluster>);
  vi.mocked(k3dClusterInfo).mockResolvedValue(clusterState("running"));
});

test("a detected version passes when its major and minor match the pin, whatever the patch", async () => {
  const { runner } = replies({ "kubectl version": "v1.31.4" });
  const checks = await doctor(managed(), runner);
  expect(byName(checks, "tool:kubectl")).toEqual(
    reported("tool:kubectl", "pass", true, "1.31.4 (pinned 1.31.0)"),
  );
});

test("a required tool at another major.minor fails, while an optional one only warns", async () => {
  const { runner } = replies({
    "kubectl version": "v1.30.0",
    "sops --version": "v3.8.0",
  });
  const checks = await doctor(managed(), runner);
  expect(byName(checks, "tool:kubectl")).toEqual(
    reported("tool:kubectl", "fail", true, "found 1.30.0, expected 1.31.0"),
  );
  expect(byName(checks, "tool:sops")).toEqual(
    reported("tool:sops", "warn", false, "found 3.8.0, expected 3.9.0"),
  );
});

test("a tool whose output names no version is reported as an unknown failure", async () => {
  const { runner } = replies({ "helm version": "no version here" });
  const checks = await doctor(managed(), runner);
  expect(byName(checks, "tool:helm")).toEqual(
    reported("tool:helm", "fail", true, "found unknown, expected 3.16.0"),
  );
});

test("an unavailable required tool fails and names the install remedy for a missing binary", async () => {
  const { runner } = replies({ "kubectl version": errno("ENOENT") });
  const checks = await doctor(managed(), runner);
  expect(byName(checks, "tool:kubectl")).toEqual(
    reported(
      "tool:kubectl",
      "fail",
      true,
      "not available: ENOENT; install the pinned version with `mise install`",
    ),
  );
});

test("an unavailable optional tool only warns, with its error and no install remedy", async () => {
  const { runner } = replies({
    "sops --version": new Error("permission denied"),
  });
  const checks = await doctor(managed(), runner);
  expect(byName(checks, "tool:sops")).toEqual(
    reported("tool:sops", "warn", false, "not available: permission denied"),
  );
  expect(doctorFailed(checks)).toBe(false);
});

test("an unreachable Docker daemon fails the container runtime check", async () => {
  const { runner } = replies({ "docker info": new Error("daemon is down") });
  const checks = await doctor(managed(), runner);
  expect(byName(checks, "container-runtime")).toEqual(
    reported(
      "container-runtime",
      "fail",
      true,
      "Docker daemon is unavailable: daemon is down",
    ),
  );
  expect(doctorFailed(checks)).toBe(true);
});

test("a local k3d environment checks the k3d binary and cluster, and no host sizing", async () => {
  const repository = fakeRepository(
    { name: "local", provider: "k3d", k3d: { clusterName: "kore-local" } },
    { ...tools, k3d: "5.7.0" },
  );
  const { runner } = replies({ "k3d version": "v5.7.0" });
  const checks = await doctor(repository, runner);
  expect(byName(checks, "tool:k3d")?.status).toBe("pass");
  expect(byName(checks, "k3d-cluster")).toEqual(
    reported("k3d-cluster", "pass", false, "kore-local is running"),
  );
  expect(checks.some((check) => check.name.startsWith("host:"))).toBe(false);
  const [environment, reader] = vi.mocked(k3dClusterInfo).mock.calls[0] ?? [];
  expect(environment).toBe(repository.environment);
  expect(reader).toBe(runner);
});

test.each([
  ["absent", "kore-local is absent; run `kore local up` to create it"],
  ["stopped", "kore-local is stopped; run `kore local up` to start it"],
])(
  "a k3d cluster that is %s is a warning that names kore local up",
  async (state, message) => {
    vi.mocked(k3dClusterInfo).mockResolvedValue(
      clusterState(state as "absent" | "stopped"),
    );
    const repository = fakeRepository({
      provider: "k3d",
      k3d: { clusterName: "kore-local" },
    });
    const checks = await doctor(repository, replies().runner);
    expect(byName(checks, "k3d-cluster")).toEqual(
      reported("k3d-cluster", "warn", false, message),
    );
    expect(doctorFailed(checks)).toBe(false);
  },
);

test("a k3d cluster that cannot be listed is a warning, not a failure", async () => {
  vi.mocked(k3dClusterInfo).mockRejectedValue(new Error("docker unreachable"));
  const repository = fakeRepository({
    provider: "k3d",
    k3d: { clusterName: "kore-local" },
  });
  const checks = await doctor(repository, replies().runner);
  expect(byName(checks, "k3d-cluster")).toEqual(
    reported(
      "k3d-cluster",
      "warn",
      false,
      "k3d cluster kore-local could not be listed: docker unreachable",
    ),
  );
});

test("a managed environment runs only version and info reads, in a fixed order", async () => {
  const { runner, run } = replies();
  const checks = await doctor(managed(), runner);
  expect(checks.map(({ name }) => name)).toEqual(managedNames);
  expect(
    run.mock.calls.map(([command, args]) => [command, ...args].join(" ")),
  ).toEqual([
    "node --version",
    "npm --version",
    "kubectl version --client=true -o json",
    "helm version --short",
    "sops --version",
    "docker --version",
    "cosign version",
    "docker info --format {{.ServerVersion}}",
  ]);
  expect(k3dClusterInfo).not.toHaveBeenCalled();
});

test("host sizing passes when the machine meets the declared sizing", async () => {
  const checks = await doctor(managed(), replies().runner);
  expect(byName(checks, "host:cpu")).toEqual(
    reported("host:cpu", "pass", true, "8 available, 4 required"),
  );
  expect(byName(checks, "host:memory")?.message).toBe(
    "16384 MiB available, 8192 MiB required",
  );
  expect(byName(checks, "host:disk")?.message).toBe(
    "200 GiB free, 100 GiB required",
  );
  expect(doctorFailed(checks)).toBe(false);
});

test("host sizing fails each resource the machine is short of", async () => {
  vi.mocked(cpus).mockReturnValue(cpuList(2));
  vi.mocked(totalmem).mockReturnValue(4096 * 1024 ** 2);
  vi.mocked(statfs).mockResolvedValue(freeDisk(50));
  const checks = await doctor(managed(), replies().runner);
  expect(byName(checks, "host:cpu")).toEqual(
    reported("host:cpu", "fail", true, "2 available, 4 required"),
  );
  expect(byName(checks, "host:memory")?.message).toBe(
    "4096 MiB available, 8192 MiB required",
  );
  expect(byName(checks, "host:disk")?.message).toBe(
    "50 GiB free, 100 GiB required",
  );
  expect(doctorFailed(checks)).toBe(true);
});

test("a managed environment without a configured context fails credentials and checks no cluster", async () => {
  const checks = await doctor(
    managed({ kubeContext: "REQUIRED" }),
    replies().runner,
  );
  expect(byName(checks, "credentials")).toEqual(
    reported(
      "credentials",
      "fail",
      true,
      "managed environment credentials/context are not configured",
    ),
  );
  expect(k3dClusterInfo).not.toHaveBeenCalled();
  expect(doctorFailed(checks)).toBe(true);
});

test("a local environment needs no cloud credentials", async () => {
  const checks = await doctor(
    fakeRepository({ provider: "k3d" }, tools),
    replies().runner,
  );
  expect(byName(checks, "credentials")).toEqual(
    reported(
      "credentials",
      "pass",
      false,
      "local environment needs no cloud credentials",
    ),
  );
});
