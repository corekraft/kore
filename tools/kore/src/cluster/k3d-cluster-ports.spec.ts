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
import type { PortProbe } from "./k3d-ports.js";

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

const LSOF = "lsof -nP -iTCP:8443 -sTCP:LISTEN -Fpc";

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
});

test("a taken host port refuses an absent cluster before any create or registry write, and no cluster command runs after the refusal", async () => {
  const probe = vi.fn<PortProbe>(async () => false);
  const absent = fakeK3d(undefined);
  await expect(up(absent.runner, probe)).rejects.toThrow(
    new Error(
      "host port 127.0.0.1:8443 is already in use, so the cluster cannot publish it. The overlay setting that publishes it is k3d.ports[0] (loadBalancerPort 443) in environment local. The holder could not be identified: lsof reported none or is not installed. Free the port by stopping the process holding it, or change k3d.ports[0].hostPort, then rerun kore local up --environment local.",
    ),
  );
  expect(commandLines(absent.run)).toEqual([LIST, LSOF]);
  expect(writeK3dRegistriesConfig).not.toHaveBeenCalled();
  expect(waitForClusterReady).not.toHaveBeenCalled();
});

test("a free host port lets the absent cluster be created on its loopback address", async () => {
  const probe = vi.fn<PortProbe>(async () => true);
  const absent = fakeK3d(undefined);
  await up(absent.runner, probe);
  expect(probe).toHaveBeenCalledWith("127.0.0.1", 8443);
  const creates = commandLines(absent.run).filter((line) =>
    line.startsWith("k3d cluster create"),
  );
  expect(creates).toHaveLength(1);
  expect(creates[0]).toContain("--port 127.0.0.1:8443:443@loadbalancer");
});

test("no probe runs when the cluster already exists, running or stopped", async () => {
  const probe = vi.fn<PortProbe>(async () => false);
  await up(fakeK3d(1).runner, probe);
  await up(fakeK3d(0).runner, probe);
  expect(probe).not.toHaveBeenCalled();
});

test("the ports checked are the effective overlay's own, so a port added to the overlay is checked and named without a code change", async () => {
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
  const probe = vi.fn<PortProbe>(
    async (_address: string, hostPort: number) => hostPort !== 9100,
  );
  const absent = fakeK3d(undefined);
  await expect(
    clusterUpK3d(overlay, absent.runner, READINESS, "/home/u", probe),
  ).rejects.toThrow(
    new Error(
      "host port 127.0.0.1:9100 is already in use, so the cluster cannot publish it. The overlay setting that publishes it is k3d.ports[2] (loadBalancerPort 30100) in environment local. The holder could not be identified: lsof reported none or is not installed. Free the port by stopping the process holding it, or change k3d.ports[2].hostPort, then rerun kore local up --environment local.",
    ),
  );
  expect(probe.mock.calls).toEqual([
    ["127.0.0.1", 8443],
    ["127.0.0.1", 9000],
    ["127.0.0.1", 9100],
  ]);
  expect(commandLines(absent.run)).toEqual([
    LIST,
    "lsof -nP -iTCP:9100 -sTCP:LISTEN -Fpc",
  ]);
});
