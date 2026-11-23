import { beforeEach, expect, test, vi } from "vitest";
import {
  featureEnabled,
  type Environment,
  type K3dCluster,
} from "../config/index.js";
import { fakeRunner } from "./cluster-support.js";
import { drift, listingReportsMappings, unreadablePorts } from "./k3d-drift.js";
import { inspectPortMappings } from "./k3d-inspect.js";
import { refuseDrift } from "./k3d-listing.js";

vi.mock("../config/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/index.js")>()),
  featureEnabled: vi.fn(),
}));
vi.mock("./k3d-drift.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./k3d-drift.js")>()),
  drift: vi.fn(),
  listingReportsMappings: vi.fn(),
  unreadablePorts: vi.fn(),
}));
vi.mock("./k3d-inspect.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./k3d-inspect.js")>()),
  inspectPortMappings: vi.fn(),
}));

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
});

test("with drift-listing-mappings on, a listing with no mappings reads docker inspect, and the difference it finds is refused", async () => {
  setFlag(true);
  vi.mocked(inspectPortMappings).mockResolvedValue(preCutover);
  vi.mocked(drift).mockReturnValue(["port 30443 (platform-dns): 8443 != 443"]);
  const { runner } = fakeRunner();

  await expect(
    refuseDrift(runner, {} as Environment, cluster, silentEntry),
  ).rejects.toThrow(/port 30443 \(platform-dns\): 8443 != 443.*down --prune/);

  expect(inspectPortMappings).toHaveBeenCalledWith(runner, "kore-local");
  expect(drift).toHaveBeenCalledWith(silentEntry, cluster, preCutover, true);
});

test("with drift-listing-mappings on, a listing with no mappings and an unreadable docker inspect is refused, naming the gap", async () => {
  setFlag(true);
  vi.mocked(inspectPortMappings).mockResolvedValue(undefined);
  const { runner } = fakeRunner();

  await expect(
    refuseDrift(runner, {} as Environment, cluster, silentEntry),
  ).rejects.toThrow(
    /does not report its load balancer's port mappings.*`docker inspect k3d-kore-local-serverlb`/,
  );

  expect(drift).not.toHaveBeenCalled();
});

test("with drift-listing-mappings off, a listing with no mappings never reads docker inspect, and drift names no flag", async () => {
  const { runner } = fakeRunner();

  await refuseDrift(runner, {} as Environment, cluster, silentEntry);

  expect(inspectPortMappings).not.toHaveBeenCalled();
  expect(drift).toHaveBeenCalledWith(silentEntry, cluster, undefined, false);
});

test("with drift-listing-mappings on, a listing that reports its mappings never reads docker inspect", async () => {
  setFlag(true);
  vi.mocked(listingReportsMappings).mockReturnValue(true);
  const { runner } = fakeRunner();

  await refuseDrift(runner, {} as Environment, cluster, silentEntry);

  expect(inspectPortMappings).not.toHaveBeenCalled();
});

test("a host address nothing reports is refused naming the gap, with docker inspect read for it", async () => {
  vi.mocked(unreadablePorts).mockReturnValue([cluster.ports[0]!]);
  vi.mocked(inspectPortMappings).mockResolvedValue(preCutover);
  const { runner } = fakeRunner();

  await expect(
    refuseDrift(runner, {} as Environment, cluster, silentEntry),
  ).rejects.toThrow(/does not report the host address of port 30443/);

  expect(inspectPortMappings).toHaveBeenCalledWith(runner, "kore-local");
  expect(drift).not.toHaveBeenCalled();
});
