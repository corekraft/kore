import { beforeEach, expect, test, vi } from "vitest";
import { featureEnabled } from "../config/index.js";
import { fakeRepository, fakeRunner, k3dEntry } from "./cluster-support.js";
import { drift, listingReportsMappings, unreadablePorts } from "./k3d-drift.js";
import { inspectPortMappings } from "./k3d-inspect.js";
import { up } from "./k3d-cluster-support.js";
import { waitForClusterReady } from "./readiness.js";

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
vi.mock("./readiness.js");

/** The cluster's docker inspect answer before the 443 cutover: the removed 8443 mapping and no 443. */
const preCutover = { "30443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }] };

/** The mapping names drift-listing-mappings as the test sets it; platform-dns is on, as in the local overlay. */
function setFlag(on: boolean): void {
  vi.mocked(featureEnabled).mockImplementation(
    (_environment, flag) =>
      flag === "platform-dns" || (on && flag === "drift-listing-mappings"),
  );
}

/** The local overlay's entry point, the way `kore local up` reads it. */
const repository = () =>
  fakeRepository({
    k3d: {
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
    },
  });

/** A running cluster whose `k3d cluster list` reports no load balancer mappings. */
function silentListing() {
  return fakeRunner((command, args) => {
    if (command === "k3d" && args[1] === "list") {
      return JSON.stringify([k3dEntry(1)]);
    }
    if (args.includes("jsonpath={.metadata.name}")) {
      return "kube-system";
    }
    return "";
  });
}

/** The commands the runner received, as the line a person would type. */
function lines(run: ReturnType<typeof silentListing>["run"]): string[] {
  return run.mock.calls.map(([command, args]) => [command, ...args].join(" "));
}

beforeEach(() => {
  vi.mocked(listingReportsMappings).mockReturnValue(false);
  vi.mocked(unreadablePorts).mockReturnValue([]);
  vi.mocked(drift).mockReturnValue([]);
  vi.mocked(inspectPortMappings).mockResolvedValue(undefined);
  vi.mocked(waitForClusterReady).mockResolvedValue(undefined);
  setFlag(false);
});

test("with drift-listing-mappings on, a listing with no mappings reads docker inspect, and a difference it finds refuses before any create or start", async () => {
  setFlag(true);
  vi.mocked(inspectPortMappings).mockResolvedValue(preCutover);
  vi.mocked(drift).mockReturnValue(["port 30443 (platform-dns): 8443 != 443"]);
  const { runner, run } = silentListing();

  await expect(up(runner, repository())).rejects.toThrow(
    /port 30443 \(platform-dns\): 8443 != 443.*kore local down --prune/,
  );

  expect(drift).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    preCutover,
    true,
  );
  expect(
    lines(run).filter((line) => /^k3d cluster (create|start)/.test(line)),
  ).toEqual([]);
  expect(waitForClusterReady).not.toHaveBeenCalled();
});

test("with drift-listing-mappings on, a listing with no mappings and an unreadable docker inspect is refused, naming the gap", async () => {
  setFlag(true);
  vi.mocked(inspectPortMappings).mockResolvedValue(undefined);
  const { runner, run } = silentListing();

  await expect(up(runner, repository())).rejects.toThrow(
    /does not report its load balancer's port mappings.*`docker inspect k3d-kore-local-serverlb`/,
  );

  expect(drift).not.toHaveBeenCalled();
  expect(
    lines(run).filter((line) => /^k3d cluster (create|start)/.test(line)),
  ).toEqual([]);
  expect(lines(run).filter((line) => line.startsWith("kubectl"))).toEqual([]);
  expect(waitForClusterReady).not.toHaveBeenCalled();
});

test("with drift-listing-mappings off, a listing with no mappings never reads docker inspect, and the cluster passes as before", async () => {
  setFlag(false);
  const { runner, run } = silentListing();

  await up(runner, repository());

  expect(inspectPortMappings).not.toHaveBeenCalled();
  expect(lines(run).filter((line) => line.startsWith("docker"))).toEqual([]);
  expect(drift).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    undefined,
    false,
  );
  expect(waitForClusterReady).toHaveBeenCalledTimes(1);
});

test("with drift-listing-mappings on, a listing that reports its mappings never reads docker inspect", async () => {
  setFlag(true);
  vi.mocked(listingReportsMappings).mockReturnValue(true);
  const { runner } = silentListing();

  await up(runner, repository());

  expect(inspectPortMappings).not.toHaveBeenCalled();
  expect(waitForClusterReady).toHaveBeenCalledTimes(1);
});
