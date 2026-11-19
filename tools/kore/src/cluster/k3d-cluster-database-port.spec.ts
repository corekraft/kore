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
import { READINESS, TRUST, TRUST_VOLUMES } from "./k3d-cluster-support.js";
import { checkHostPorts } from "./k3d-ports.js";

// Docs: docs/decisions/0136-the-shared-gateway-publishes-database-routes-on-loopback-5432-behind-database-routes.md

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

const gatewayPort = {
  hostAddress: "127.0.0.1",
  hostPort: 8443,
  loadBalancerPort: 443,
};
const postgresPort = {
  hostAddress: "127.0.0.1",
  hostPort: 5432,
  loadBalancerPort: 30432,
  featureFlag: "database-routes",
};

function withPostgresPort(databaseRoutes: boolean, optOut?: boolean) {
  return fakeRepository({
    features: { "database-routes": databaseRoutes },
    k3d: {
      clusterName: "kore-local",
      serviceCidr: "10.96.0.0/12",
      ports: [
        gatewayPort,
        { ...postgresPort, ...(optOut === undefined ? {} : { optOut }) },
      ],
    },
  });
}

test("with database-routes on, the drift check compares an existing cluster to the overlay with the 5432 mapping, so a cluster created without it is named", async () => {
  await clusterUpK3d(
    withPostgresPort(true),
    fakeK3d(1).runner,
    READINESS,
    "/home/u",
  );
  expect(vi.mocked(drift).mock.calls[0]?.[1].ports).toEqual([
    gatewayPort,
    postgresPort,
  ]);
});

test("with database-routes off, the drift check and the host port check never see the 5432 mapping, so a host already using 5432 is not refused", async () => {
  await clusterUpK3d(
    withPostgresPort(false),
    fakeK3d(1).runner,
    READINESS,
    "/home/u",
  );
  expect(vi.mocked(drift).mock.calls[0]?.[1].ports).toEqual([gatewayPort]);
  await clusterUpK3d(
    withPostgresPort(false),
    fakeK3d(undefined).runner,
    READINESS,
    "/home/u",
    async () => true,
  );
  expect(vi.mocked(checkHostPorts).mock.calls[0]?.[1].ports).toEqual([
    gatewayPort,
  ]);
});

test("an environment that opts out drops the 5432 mapping from the drift check, the host port check and the create arguments, though the flag is on", async () => {
  await clusterUpK3d(
    withPostgresPort(true, true),
    fakeK3d(1).runner,
    READINESS,
    "/home/u",
  );
  expect(vi.mocked(drift).mock.calls[0]?.[1].ports).toEqual([gatewayPort]);
  const absent = fakeK3d(undefined);
  await clusterUpK3d(
    withPostgresPort(true, true),
    absent.runner,
    READINESS,
    "/home/u",
    async () => true,
  );
  expect(vi.mocked(checkHostPorts).mock.calls[0]?.[1].ports).toEqual([
    gatewayPort,
  ]);
  expect(
    commandLines(absent.run)
      .filter((line) => line.startsWith("k3d cluster create"))
      .flatMap((line) =>
        line.split(" --").filter((a) => a.startsWith("port ")),
      ),
  ).toEqual(["port 127.0.0.1:8443:443@loadbalancer"]);
});

test("with the flag on and no opt-out, the create arguments publish 5432 on the loopback address only", async () => {
  const absent = fakeK3d(undefined);
  await clusterUpK3d(
    withPostgresPort(true),
    absent.runner,
    READINESS,
    "/home/u",
    async () => true,
  );
  expect(
    commandLines(absent.run)
      .filter((line) => line.startsWith("k3d cluster create"))
      .flatMap((line) =>
        line.split(" --").filter((a) => a.startsWith("port ")),
      ),
  ).toEqual([
    "port 127.0.0.1:8443:443@loadbalancer",
    "port 127.0.0.1:5432:30432@loadbalancer",
  ]);
});
