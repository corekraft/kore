import { beforeEach, expect, test, vi } from "vitest";
import {
  k3dTrustDirectory,
  k3dTrustVolumeArgs,
  koreManagesRegistryAuth,
  registryAddress,
  writeK3dRegistriesConfig,
} from "../images/index.js";
import { clusterUpK3d } from "./k3d-cluster.js";
import { drift, unreadablePorts } from "./k3d-drift.js";
import { inspectPortMappings } from "./k3d-inspect.js";
import { commandLines, fakeK3d, fakeRepository } from "./cluster-support.js";
import { waitForClusterReady } from "./readiness.js";
import {
  LIST,
  READINESS,
  TRUST,
  TRUST_VOLUMES,
} from "./k3d-cluster-support.js";
import { checkHostPorts, type PortProbe } from "./k3d-ports.js";

vi.mock("../images/index.js");
vi.mock("./readiness.js");
vi.mock("./k3d-drift.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./k3d-drift.js")>()),
  drift: vi.fn(),
  unreadablePorts: vi.fn(),
}));
vi.mock("./k3d-inspect.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./k3d-inspect.js")>()),
  inspectPortMappings: vi.fn(),
}));
vi.mock("./k3d-ports.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./k3d-ports.js")>()),
  checkHostPorts: vi.fn(),
}));

const up = (runner: Parameters<typeof clusterUpK3d>[1], probe: PortProbe) =>
  clusterUpK3d(fakeRepository(), runner, READINESS, "/home/u", probe);

beforeEach(() => {
  vi.mocked(k3dTrustDirectory).mockReturnValue(TRUST);
  vi.mocked(k3dTrustVolumeArgs).mockReturnValue(TRUST_VOLUMES);
  vi.mocked(koreManagesRegistryAuth).mockReturnValue(true);
  vi.mocked(registryAddress).mockReturnValue("10.96.0.50:5000");
  vi.mocked(writeK3dRegistriesConfig).mockResolvedValue(undefined);
  vi.mocked(waitForClusterReady).mockResolvedValue(undefined);
  vi.mocked(drift).mockReturnValue([]);
  vi.mocked(unreadablePorts).mockReturnValue([]);
  vi.mocked(inspectPortMappings).mockResolvedValue(undefined);
  vi.mocked(checkHostPorts).mockResolvedValue(undefined);
});

test("an absent cluster has its host ports checked once, with the environment name, the overlay's cluster, the runner and the probe", async () => {
  const probe = vi.fn<PortProbe>(async () => true);
  const absent = fakeK3d(undefined);
  const repository = fakeRepository();
  await clusterUpK3d(repository, absent.runner, READINESS, "/home/u", probe);
  expect(checkHostPorts).toHaveBeenCalledTimes(1);
  expect(checkHostPorts).toHaveBeenCalledWith(
    "local",
    repository.environment.k3d,
    absent.runner,
    probe,
  );
});

test("a refusal from the host port check stops the run before the registry write and the create, so no cluster command runs after it", async () => {
  vi.mocked(checkHostPorts).mockRejectedValue(
    new Error("refused by the host port check"),
  );
  const absent = fakeK3d(undefined);
  await expect(up(absent.runner, async () => true)).rejects.toThrow(
    "refused by the host port check",
  );
  expect(writeK3dRegistriesConfig).not.toHaveBeenCalled();
  expect(commandLines(absent.run)).toEqual([LIST]);
  expect(waitForClusterReady).not.toHaveBeenCalled();
});

test("a passing host port check lets the absent cluster be created on its loopback address", async () => {
  const absent = fakeK3d(undefined);
  await up(absent.runner, async () => true);
  const creates = commandLines(absent.run).filter((line) =>
    line.startsWith("k3d cluster create"),
  );
  expect(creates).toHaveLength(1);
  expect(creates[0]).toContain("--port 127.0.0.1:8443:443@loadbalancer");
});

test("no host port check runs when the cluster is running or stopped", async () => {
  const probe = vi.fn<PortProbe>(async () => false);
  await up(fakeK3d(1).runner, probe);
  await up(fakeK3d(0).runner, probe);
  expect(checkHostPorts).not.toHaveBeenCalled();
  expect(probe).not.toHaveBeenCalled();
});

test("the check receives the effective overlay's own cluster, so a port added to the overlay is checked without a code change", async () => {
  const overlay = fakeRepository({
    k3d: {
      clusterName: "kore-local",
      serviceCidr: "10.96.0.0/12",
      ports: [
        { hostAddress: "127.0.0.1", hostPort: 8443, loadBalancerPort: 443 },
        { hostAddress: "127.0.0.1", hostPort: 9000, loadBalancerPort: 30000 },
        { hostAddress: "127.0.0.1", hostPort: 9100, loadBalancerPort: 30100 },
      ],
    },
  });
  const probe = vi.fn<PortProbe>(async () => true);
  const absent = fakeK3d(undefined);
  await clusterUpK3d(overlay, absent.runner, READINESS, "/home/u", probe);
  expect(checkHostPorts).toHaveBeenCalledWith(
    "local",
    overlay.environment.k3d,
    absent.runner,
    probe,
  );
});
