import { beforeEach, expect, test, vi } from "vitest";
import {
  k3dTrustDirectory,
  k3dTrustVolumeArgs,
  koreManagesRegistryAuth,
  registryAddress,
  writeK3dRegistriesConfig,
} from "../images/index.js";
import { k3dCreateArgs } from "./k3d-cluster.js";
import { drift, unreadablePorts } from "./k3d-drift.js";
import { inspectPortMappings } from "./k3d-inspect.js";
import { commandLines, fakeK3d, fakeRepository } from "./cluster-support.js";
import { waitForClusterReady } from "./readiness.js";
import {
  LIST,
  MESSAGES,
  NAMESPACE_CHECK,
  TRUST,
  TRUST_VOLUMES,
  up,
} from "./k3d-cluster-support.js";

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

test("every host port is published on the loopback address its overlay entry declares, so no create argument leaves a port on all interfaces", () => {
  const two = fakeRepository({
    k3d: {
      clusterName: "kore-local",
      serviceCidr: "10.96.0.0/12",
      ports: [
        { hostAddress: "127.0.0.1", hostPort: 8443, loadBalancerPort: 443 },
        { hostAddress: "127.0.0.2", hostPort: 9000, loadBalancerPort: 30000 },
      ],
    },
  });
  expect(
    k3dCreateArgs(two, TRUST).filter((arg) => arg.endsWith("@loadbalancer")),
  ).toEqual([
    "127.0.0.1:8443:443@loadbalancer",
    "127.0.0.2:9000:30000@loadbalancer",
  ]);
});

test("the API port is published with a random host port on the first declared port's loopback address, so no create argument leaves it on all interfaces", () => {
  const two = fakeRepository({
    k3d: {
      clusterName: "kore-local",
      serviceCidr: "10.96.0.0/12",
      ports: [
        { hostAddress: "127.0.0.2", hostPort: 9000, loadBalancerPort: 30000 },
        { hostAddress: "127.0.0.1", hostPort: 8443, loadBalancerPort: 443 },
      ],
    },
  });
  const args = k3dCreateArgs(two, TRUST);
  expect(args[args.indexOf("--api-port") + 1]).toBe("127.0.0.2:random");
});

test("a drift verdict on the host address is refused with the recreate path before any start or write, and docker inspect is not consulted when the listing reports the address", async () => {
  vi.mocked(drift).mockReturnValue(["port 443 address: 0.0.0.0 != 127.0.0.1"]);
  const wide = fakeK3d(1);
  await expect(up(wide.runner)).rejects.toThrow(
    new Error(MESSAGES.wrongAddress),
  );
  expect(commandLines(wide.run)).toEqual([LIST]);
  expect(inspectPortMappings).not.toHaveBeenCalled();
  expect(writeK3dRegistriesConfig).not.toHaveBeenCalled();
  expect(waitForClusterReady).not.toHaveBeenCalled();
});

test("a port whose host address neither the listing nor docker inspect reports is refused, naming both commands and not the recreate path", async () => {
  vi.mocked(unreadablePorts).mockReturnValue([
    { hostAddress: "127.0.0.1", hostPort: 8443, loadBalancerPort: 443 },
  ]);
  const silent = fakeK3d(1);
  await expect(up(silent.runner)).rejects.toThrow(
    new Error(MESSAGES.unreadableAddress),
  );
  expect(inspectPortMappings).toHaveBeenCalledWith(silent.runner, "kore-local");
  expect(waitForClusterReady).not.toHaveBeenCalled();
});

test("a cluster whose drift verdict is empty passes with the commands of a matching cluster", async () => {
  const matching = fakeK3d(1);
  await up(matching.runner);
  expect(commandLines(matching.run)).toEqual([LIST, LIST, NAMESPACE_CHECK]);
  expect(inspectPortMappings).not.toHaveBeenCalled();
  expect(waitForClusterReady).toHaveBeenCalledTimes(1);
});
