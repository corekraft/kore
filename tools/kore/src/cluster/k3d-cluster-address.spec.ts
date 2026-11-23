import { beforeEach, expect, test, vi } from "vitest";
import {
  k3dTrustDirectory,
  k3dTrustVolumeArgs,
  koreManagesRegistryAuth,
  registryAddress,
  writeK3dRegistriesConfig,
} from "../images/index.js";
import { k3dCreateArgs } from "./k3d-cluster.js";
import { apiHostAddress } from "./k3d-drift.js";
import { refuseDrift } from "./k3d-listing.js";
import { commandLines, fakeK3d, fakeRepository } from "./cluster-support.js";
import { waitForClusterReady } from "./readiness.js";
import {
  LIST,
  NAMESPACE_CHECK,
  TRUST,
  TRUST_VOLUMES,
  up,
} from "./k3d-cluster-support.js";

vi.mock("../images/index.js");
vi.mock("./readiness.js");
vi.mock("./k3d-drift.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./k3d-drift.js")>()),
  apiHostAddress: vi.fn(),
}));
vi.mock("./k3d-listing.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./k3d-listing.js")>()),
  refuseDrift: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(k3dTrustDirectory).mockReturnValue(TRUST);
  vi.mocked(k3dTrustVolumeArgs).mockReturnValue(TRUST_VOLUMES);
  vi.mocked(koreManagesRegistryAuth).mockReturnValue(true);
  vi.mocked(registryAddress).mockReturnValue("10.96.0.50:5000");
  vi.mocked(writeK3dRegistriesConfig).mockResolvedValue(undefined);
  vi.mocked(waitForClusterReady).mockResolvedValue(undefined);
  vi.mocked(refuseDrift).mockResolvedValue(undefined);
});

test("every host port is published on the loopback address its overlay entry declares, so no create argument leaves a port on all interfaces", () => {
  const two = fakeRepository({
    k3d: {
      clusterName: "kore-local",
      serviceCidr: "10.96.0.0/12",
      ports: [
        { hostAddress: "127.0.0.1", hostPort: 443, loadBalancerPort: 443 },
        { hostAddress: "127.0.0.2", hostPort: 9000, loadBalancerPort: 30000 },
      ],
    },
  });
  expect(
    k3dCreateArgs(two, TRUST).filter((arg) => arg.endsWith("@loadbalancer")),
  ).toEqual([
    "127.0.0.1:443:443@loadbalancer",
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
        { hostAddress: "127.0.0.1", hostPort: 443, loadBalancerPort: 443 },
      ],
    },
  });
  vi.mocked(apiHostAddress).mockReturnValue("127.0.0.2");
  const args = k3dCreateArgs(two, TRUST);
  expect(apiHostAddress).toHaveBeenCalledWith(two.environment.k3d);
  expect(args[args.indexOf("--api-port") + 1]).toBe("127.0.0.2:random");
});

test("a cluster whose drift verdict is empty passes with the commands of a matching cluster", async () => {
  const matching = fakeK3d(1);
  await up(matching.runner);
  expect(commandLines(matching.run)).toEqual([LIST, LIST, NAMESPACE_CHECK]);
  expect(waitForClusterReady).toHaveBeenCalledTimes(1);
});

test("a mapping with no protocol is passed as before, and a UDP mapping on the same host port as a TCP one is passed beside it", () => {
  const dns = fakeRepository({
    k3d: {
      clusterName: "kore-local",
      serviceCidr: "10.96.0.0/12",
      ports: [
        { hostAddress: "127.0.0.1", hostPort: 1053, loadBalancerPort: 1053 },
        {
          hostAddress: "127.0.0.1",
          hostPort: 1053,
          loadBalancerPort: 1053,
          protocol: "udp",
        },
        {
          hostAddress: "127.0.0.1",
          hostPort: 443,
          loadBalancerPort: 443,
          protocol: "tcp",
        },
      ],
    },
  });
  expect(
    k3dCreateArgs(dns, TRUST).filter((arg) => arg.endsWith("@loadbalancer")),
  ).toEqual([
    "127.0.0.1:1053:1053@loadbalancer",
    "127.0.0.1:1053:1053/udp@loadbalancer",
    "127.0.0.1:443:443@loadbalancer",
  ]);
});
