import { beforeEach, expect, test, vi } from "vitest";
import {
  assertExpectedCluster,
  ClusterUnavailableError,
  clusterUp,
} from "../cluster/index.js";
import {
  enabledComponents,
  featureEnabled,
  isLocalProvider,
} from "../config/index.js";
import { ensureLocalSigningPublicKey } from "../images/index.js";
import { closeExistingAdmissionGate } from "./admission-gate.js";
import {
  bootstrapControllers,
  closeApplicationAdmission,
} from "./bootstrap.js";
import { bootstrapComponent } from "./bootstrap-component.js";
import { assertNoOrphanedReleases } from "./gated-release.js";
import * as readinessGate from "./readiness-gate.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";

vi.mock("../cluster/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../cluster/index.js")>()),
  assertExpectedCluster: vi.fn(),
  clusterUp: vi.fn(),
}));
vi.mock("../config/index.js");
vi.mock("../images/index.js");
vi.mock("./admission-gate.js");
vi.mock("./bootstrap-component.js");
vi.mock("./gated-release.js");
vi.mock("./readiness-gate.js");

const local = fakeRepository({ provider: "k3d" });
const managed = fakeRepository({ provider: "managed" });
const registry = fakeComponent({ name: "oci-registry", phase: "bootstrap" });
const gate = fakeComponent({ name: "gate", phase: "core" });
const policy = fakeComponent({ name: "policy", phase: "configuration" });
const enforce = fakeComponent({ name: "enforce", phase: "enforcement" });

/** Every collaborator records its name, so a test can assert the whole order. */
let order: string[];

beforeEach(() => {
  order = [];
  const record = (name: string) => async () => void order.push(name);
  vi.mocked(assertExpectedCluster).mockImplementation(record("cluster"));
  vi.mocked(clusterUp).mockImplementation(record("cluster-up"));
  vi.mocked(closeExistingAdmissionGate).mockImplementation(
    record("close-gate"),
  );
  vi.mocked(assertNoOrphanedReleases).mockImplementation(record("orphans"));
  vi.mocked(ensureLocalSigningPublicKey).mockImplementation(
    record("signing-key"),
  );
  vi.mocked(bootstrapComponent).mockImplementation(
    async (_repo, _runner, c) => {
      order.push(`reconcile:${c.name}`);
    },
  );
  vi.mocked(isLocalProvider).mockImplementation(
    (environment) => environment.provider === "k3d",
  );
  vi.mocked(enabledComponents).mockReturnValue([
    registry,
    gate,
    policy,
    enforce,
  ]);
});

test("a local cluster that is up is used as it is, with nothing created", async () => {
  await bootstrapControllers(local, fakeRunner().runner);
  expect(clusterUp).not.toHaveBeenCalled();
  expect(order[0]).toBe("cluster");
});

/** A running kore-local entry in the shape `k3d cluster list --output json` reports, with its load balancer's mappings. */
function listedCluster(portMappings: Record<string, Binding[]>): string {
  return JSON.stringify([
    {
      name: "kore-local",
      serversCount: 1,
      serversRunning: 1,
      agentsCount: 0,
      agentsRunning: 0,
      hasLoadBalancer: true,
      nodes: [
        {
          name: "k3d-kore-local-serverlb",
          role: "loadbalancer",
          portMappings,
        },
      ],
    },
  ]);
}

interface Binding {
  HostIp: string;
  HostPort: string;
}

/** The mappings of a cluster created before the 443 cutover: 8443 on the entry point and no 443 (#1683). */
const preCutoverMappings: Record<string, Binding[]> = {
  "30443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }],
  "31053/tcp": [{ HostIp: "127.0.0.1", HostPort: "1053" }],
  "31053/udp": [{ HostIp: "127.0.0.1", HostPort: "1053" }],
  "30432/tcp": [{ HostIp: "127.0.0.1", HostPort: "5432" }],
  "6443/tcp": [{ HostIp: "127.0.0.1", HostPort: "41234" }],
};

/** The same cluster after the cutover: the 443 entry point published. */
const cutoverMappings: Record<string, Binding[]> = {
  ...preCutoverMappings,
  "30443/tcp": [{ HostIp: "127.0.0.1", HostPort: "443" }],
};

/** The local overlay's published ports, with platform-dns and database-routes on, as the running cluster is compared. */
const localWithPorts = fakeRepository({
  provider: "k3d",
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
      {
        hostAddress: "127.0.0.1",
        hostPort: 1053,
        loadBalancerPort: 31053,
        protocol: "tcp",
        featureFlag: "platform-dns",
      },
      {
        hostAddress: "127.0.0.1",
        hostPort: 1053,
        loadBalancerPort: 31053,
        protocol: "udp",
        featureFlag: "platform-dns",
      },
      {
        hostAddress: "127.0.0.1",
        hostPort: 5432,
        loadBalancerPort: 30432,
        featureFlag: "database-routes",
      },
    ],
  },
});

/** Sets the flags the running-cluster check reads: the ports' flags on, and drift-listing-mappings as given. */
function setDriftFlag(on: boolean): void {
  vi.mocked(featureEnabled).mockImplementation(
    (_environment, flag) =>
      flag === "platform-dns" ||
      flag === "database-routes" ||
      (on && flag === "drift-listing-mappings"),
  );
}

/** A runner whose `k3d cluster list` answers the given listing, and whose every other command answers nothing. */
function listingRunner(listing: string) {
  return fakeRunner((command) => (command === "k3d" ? listing : "")).runner;
}

test("with drift-listing-mappings on, a running cluster whose listing differs from the overlay is refused before bootstrap touches it (#1683)", async () => {
  setDriftFlag(true);
  const runner = listingRunner(listedCluster(preCutoverMappings));

  await expect(bootstrapControllers(localWithPorts, runner)).rejects.toThrow(
    "port 30443 (platform-dns): 8443 != 443",
  );

  expect(clusterUp).not.toHaveBeenCalled();
  expect(order).toEqual([]);
});

test("with drift-listing-mappings off, the same running cluster is used as it was before the check (#1683)", async () => {
  setDriftFlag(false);
  const runner = listingRunner(listedCluster(preCutoverMappings));

  await bootstrapControllers(localWithPorts, runner);

  expect(clusterUp).not.toHaveBeenCalled();
  expect(order[0]).toBe("cluster");
});

test("with drift-listing-mappings on, a running cluster whose listing matches the overlay is used as it is", async () => {
  setDriftFlag(true);
  const runner = listingRunner(listedCluster(cutoverMappings));

  await bootstrapControllers(localWithPorts, runner);

  expect(clusterUp).not.toHaveBeenCalled();
  expect(order[0]).toBe("cluster");
});

test("a local cluster that is not there is created, then bootstrap continues", async () => {
  vi.mocked(assertExpectedCluster).mockRejectedValueOnce(
    new ClusterUnavailableError("k3d-kore-local"),
  );
  await bootstrapControllers(local, fakeRunner().runner);
  expect(order.slice(0, 3)).toEqual(["cluster-up", "close-gate", "orphans"]);
});

test("a managed cluster that is not there is never created, and the failure stops bootstrap", async () => {
  vi.mocked(assertExpectedCluster).mockRejectedValueOnce(
    new ClusterUnavailableError("managed"),
  );
  await expect(
    bootstrapControllers(managed, fakeRunner().runner),
  ).rejects.toThrow(ClusterUnavailableError);
  expect(clusterUp).not.toHaveBeenCalled();
  expect(order).toEqual([]);
});

test("a cluster failure that is not unavailability is rethrown, never masked by creating a cluster", async () => {
  vi.mocked(assertExpectedCluster).mockRejectedValueOnce(
    new Error("kubectl crashed"),
  );
  await expect(
    bootstrapControllers(local, fakeRunner().runner),
  ).rejects.toThrow("kubectl crashed");
  expect(clusterUp).not.toHaveBeenCalled();
});

test("bootstrap closes the admission gate, then checks for orphaned releases, before any component", async () => {
  await bootstrapControllers(local, fakeRunner().runner);
  expect(order.slice(0, 3)).toEqual(["cluster", "close-gate", "orphans"]);
  expect(order[3]).toBe("reconcile:oci-registry");
});

test("each bootstrap component is reconciled in order, and configuration and enforcement components are left to up", async () => {
  await bootstrapControllers(local, fakeRunner().runner);
  const reconciled = order.filter((step) => step.startsWith("reconcile:"));
  expect(reconciled).toEqual(["reconcile:oci-registry", "reconcile:gate"]);
});

test("the local signing key is written last on a local environment", async () => {
  await bootstrapControllers(local, fakeRunner().runner);
  expect(order.at(-1)).toBe("signing-key");
});

test("a managed environment never writes the local signing key", async () => {
  await bootstrapControllers(managed, fakeRunner().runner);
  expect(ensureLocalSigningPublicKey).not.toHaveBeenCalled();
});

test("a component that fails to reconcile stops bootstrap before the later steps", async () => {
  vi.mocked(bootstrapComponent).mockRejectedValueOnce(new Error("crd stuck"));
  await expect(
    bootstrapControllers(local, fakeRunner().runner),
  ).rejects.toThrow("crd stuck");
  expect(ensureLocalSigningPublicKey).not.toHaveBeenCalled();
});

test("closing the application admission gate is the existing gate's close, with the same runner", async () => {
  const { runner } = fakeRunner();
  await closeApplicationAdmission(local, runner);
  expect(closeExistingAdmissionGate).toHaveBeenCalledWith(local, runner);
});

test("bootstrap re-exports the readiness gate's open and degraded-close operations unchanged", async () => {
  const bootstrap = await import("./bootstrap.js");
  expect(bootstrap.openApplicationAdmission).toBe(
    readinessGate.openApplicationAdmission,
  );
  expect(bootstrap.closeGateIfDegraded).toBe(readinessGate.closeGateIfDegraded);
});

const gatekeeper = fakeComponent({ name: "gatekeeper", phase: "bootstrap" });
const crds = fakeComponent({ name: "agentgateway-crds", phase: "bootstrap" });

test("components after Gatekeeper are told Gatekeeper is installed, and Gatekeeper and those ahead of it are not", async () => {
  vi.mocked(enabledComponents).mockReturnValue([registry, gatekeeper, crds]);
  await bootstrapControllers(local, fakeRunner().runner);
  expect(
    vi
      .mocked(bootstrapComponent)
      .mock.calls.map(([, , component, afterGatekeeper]) => [
        component.name,
        afterGatekeeper,
      ]),
  ).toEqual([
    ["oci-registry", false],
    ["gatekeeper", false],
    ["agentgateway-crds", true],
  ]);
});

test("a Gatekeeper wait that fails stops bootstrap before the later steps", async () => {
  vi.mocked(enabledComponents).mockReturnValue([gatekeeper, crds, registry]);
  vi.mocked(bootstrapComponent).mockImplementation(
    async (_repo, _runner, component, afterGatekeeper) => {
      if (afterGatekeeper) {
        throw new Error("gatekeeper-webhook-service has no ready endpoints");
      }
      order.push(`reconcile:${component.name}`);
    },
  );
  await expect(
    bootstrapControllers(local, fakeRunner().runner),
  ).rejects.toThrow("gatekeeper-webhook-service has no ready endpoints");
  expect(order).not.toContain("reconcile:oci-registry");
  expect(ensureLocalSigningPublicKey).not.toHaveBeenCalled();
});
