import { beforeEach, expect, test, vi } from "vitest";
import {
  k3dTrustDirectory,
  k3dTrustVolumeArgs,
  koreManagesRegistryAuth,
  registryAddress,
  writeK3dRegistriesConfig,
} from "../images/index.js";
import { k3dCreateArgs } from "./k3d-cluster.js";
import { commandLines, fakeK3d, fakeRepository } from "./cluster-support.js";
import { waitForClusterReady } from "./readiness.js";
import {
  LIST,
  MESSAGES,
  NAMESPACE_CHECK,
  loadBalancer,
  TRUST,
  TRUST_VOLUMES,
  up,
} from "./k3d-cluster-support.js";

vi.mock("../images/index.js");
vi.mock("./readiness.js");

beforeEach(() => {
  vi.mocked(k3dTrustDirectory).mockReturnValue(TRUST);
  vi.mocked(k3dTrustVolumeArgs).mockReturnValue(TRUST_VOLUMES);
  vi.mocked(koreManagesRegistryAuth).mockReturnValue(true);
  vi.mocked(registryAddress).mockReturnValue("10.96.0.50:5000");
  vi.mocked(writeK3dRegistriesConfig).mockResolvedValue(undefined);
  vi.mocked(waitForClusterReady).mockResolvedValue(undefined);
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

test("a published port bound off loopback is drift: the recreate path names the address, before any start or write", async () => {
  const wide = fakeK3d(1, {
    nodes: loadBalancer({
      "443/tcp": [{ HostIp: "0.0.0.0", HostPort: "8443" }],
    }),
  });
  await expect(up(wide.runner)).rejects.toThrow(
    new Error(MESSAGES.wrongAddress),
  );
  expect(commandLines(wide.run)).toEqual([LIST]);
  expect(writeK3dRegistriesConfig).not.toHaveBeenCalled();
  expect(waitForClusterReady).not.toHaveBeenCalled();
});

test("a published port whose host address the list does not report is drift, named as unreported", async () => {
  const silent = fakeK3d(1, {
    nodes: loadBalancer({ "443/tcp": [{ HostPort: "8443" }] }),
  });
  await expect(up(silent.runner)).rejects.toThrow(
    new Error(MESSAGES.unreportedAddress),
  );
  expect(waitForClusterReady).not.toHaveBeenCalled();
});

test("a published port on the overlay's loopback address and port passes the drift check with the commands of a matching cluster", async () => {
  const matching = fakeK3d(1, {
    nodes: loadBalancer({
      "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }],
    }),
  });
  await up(matching.runner);
  expect(commandLines(matching.run)).toEqual([LIST, LIST, NAMESPACE_CHECK]);
  expect(waitForClusterReady).toHaveBeenCalledTimes(1);
});
