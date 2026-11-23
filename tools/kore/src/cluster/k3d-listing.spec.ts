import { beforeEach, expect, test, vi } from "vitest";
import { featureEnabled, type K3dCluster } from "../config/index.js";
import { fakeRepository, fakeRunner } from "./cluster-support.js";
import {
  differsMessage,
  drift,
  listingReportsMappings,
  unmappedMessage,
  unreadableMessage,
  unreadablePorts,
} from "./k3d-drift.js";
import { inspectPortMappings, loadBalancerContainer } from "./k3d-inspect.js";
import { refuseDrift } from "./k3d-listing.js";

vi.mock("../config/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/index.js")>()),
  featureEnabled: vi.fn(),
}));
vi.mock("./k3d-drift.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./k3d-drift.js")>()),
  differsMessage: vi.fn(),
  drift: vi.fn(),
  listingReportsMappings: vi.fn(),
  unmappedMessage: vi.fn(),
  unreadableMessage: vi.fn(),
  unreadablePorts: vi.fn(),
}));
vi.mock("./k3d-inspect.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./k3d-inspect.js")>()),
  inspectPortMappings: vi.fn(),
  loadBalancerContainer: vi.fn(),
}));

const environment = fakeRepository().environment;

/** The cluster the local overlay declares: its 443 entry point, published by platform-dns. */
const cluster: K3dCluster = {
  clusterName: "kore-local",
  serviceCidr: "10.96.0.0/12",
  ports: [
    {
      hostAddress: "127.0.0.1",
      hostPort: 443,
      loadBalancerPort: 30443,
      featureFlag: "platform-dns",
    },
  ],
};

/** A cluster entry whose listing reports no load balancer mappings. */
const silentEntry = { name: "kore-local", serversCount: 1, agentsCount: 0 };

/** The cluster's docker inspect answer before the 443 cutover: the removed 8443 mapping and no 443. */
const preCutover = { "30443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }] };

/** Sets drift-listing-mappings as given; platform-dns is on, as in the local overlay. */
function setFlag(on: boolean): void {
  vi.mocked(featureEnabled).mockImplementation(
    (_environment, flag) =>
      flag === "platform-dns" || (on && flag === "drift-listing-mappings"),
  );
}

beforeEach(() => {
  setFlag(false);
  vi.mocked(listingReportsMappings).mockReturnValue(false);
  vi.mocked(unreadablePorts).mockReturnValue([]);
  vi.mocked(drift).mockReturnValue([]);
  vi.mocked(inspectPortMappings).mockResolvedValue(undefined);
  vi.mocked(loadBalancerContainer).mockReturnValue("k3d-kore-local-serverlb");
  vi.mocked(differsMessage).mockReturnValue("DIFFERS");
  vi.mocked(unmappedMessage).mockReturnValue("UNMAPPED");
  vi.mocked(unreadableMessage).mockReturnValue("UNREADABLE");
});

test("with drift-listing-mappings on, a listing with no mappings reads docker inspect, and the differences it finds are refused with their message", async () => {
  setFlag(true);
  vi.mocked(inspectPortMappings).mockResolvedValue(preCutover);
  vi.mocked(drift).mockReturnValue(["port 30443 (platform-dns): 8443 != 443"]);
  const { runner } = fakeRunner();

  await expect(
    refuseDrift(runner, environment, cluster, silentEntry),
  ).rejects.toThrow("DIFFERS");

  expect(inspectPortMappings).toHaveBeenCalledWith(runner, "kore-local");
  expect(drift).toHaveBeenCalledWith(silentEntry, cluster, preCutover, true);
  expect(differsMessage).toHaveBeenCalledWith("kore-local", [
    "port 30443 (platform-dns): 8443 != 443",
  ]);
});

test("with drift-listing-mappings on, a listing with no mappings and an unreadable docker inspect is refused with the unmapped message, and drift is not run", async () => {
  setFlag(true);
  vi.mocked(inspectPortMappings).mockResolvedValue(undefined);
  const { runner } = fakeRunner();

  await expect(
    refuseDrift(runner, environment, cluster, silentEntry),
  ).rejects.toThrow("UNMAPPED");

  expect(loadBalancerContainer).toHaveBeenCalledWith("kore-local");
  expect(unmappedMessage).toHaveBeenCalledWith(
    "kore-local",
    "k3d-kore-local-serverlb",
  );
  expect(drift).not.toHaveBeenCalled();
});

test("with drift-listing-mappings off, a listing with no mappings never reads docker inspect, and drift runs with the flag off", async () => {
  const { runner } = fakeRunner();

  await refuseDrift(runner, environment, cluster, silentEntry);

  expect(inspectPortMappings).not.toHaveBeenCalled();
  expect(drift).toHaveBeenCalledWith(silentEntry, cluster, undefined, false);
});

test("with drift-listing-mappings on, a listing that reports its mappings never reads docker inspect", async () => {
  setFlag(true);
  vi.mocked(listingReportsMappings).mockReturnValue(true);
  const { runner } = fakeRunner();

  await refuseDrift(runner, environment, cluster, silentEntry);

  expect(inspectPortMappings).not.toHaveBeenCalled();
});

test("a host address nothing reports is refused with the unreadable message, with docker inspect read for it and drift not run", async () => {
  const port = cluster.ports[0];
  if (port === undefined) {
    throw new Error("the cluster fixture declares its 443 port");
  }
  vi.mocked(unreadablePorts).mockReturnValue([port]);
  vi.mocked(inspectPortMappings).mockResolvedValue(preCutover);
  const { runner } = fakeRunner();

  await expect(
    refuseDrift(runner, environment, cluster, silentEntry),
  ).rejects.toThrow("UNREADABLE");

  expect(inspectPortMappings).toHaveBeenCalledWith(runner, "kore-local");
  expect(unreadableMessage).toHaveBeenCalledWith(
    "kore-local",
    "k3d-kore-local-serverlb",
    [port],
    false,
  );
  expect(drift).not.toHaveBeenCalled();
});
