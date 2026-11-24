import { beforeEach, expect, test, vi } from "vitest";
import { featureEnabled, keycloakRealmWaitFlag } from "../config/index.js";
import { CommandError } from "../runtime/index.js";
import { SETTLED_READS, waitForKeycloakRealm } from "./keycloak-realm-wait.js";
import { fakeRepository, fakeRunner } from "./platform-support.js";
import { errorMessage } from "./probe.js";
import { ReadinessTimeout, pollUntil } from "./readiness-poll.js";

vi.mock("../config/index.js");
vi.mock("./probe.js");
// Only the poll is replaced: ReadinessTimeout stays the real error class.
vi.mock("./readiness-poll.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./readiness-poll.js")>()),
  pollUntil: vi.fn(),
}));

// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md

const repository = fakeRepository();
const discovery =
  "/api/v1/namespaces/keycloak/services/keycloak-service:8080/proxy/realms/platform/.well-known/openid-configuration";

const settledStatefulSet = JSON.stringify({
  metadata: { generation: 4 },
  spec: { replicas: 1 },
  status: {
    observedGeneration: 4,
    replicas: 1,
    readyReplicas: 1,
    updatedReplicas: 1,
    currentRevision: "keycloak-b",
    updateRevision: "keycloak-b",
  },
});
const readyKeycloak = JSON.stringify({
  status: { conditions: [{ type: "Ready", status: "True" }] },
});
const answering = '{"issuer":"https://k"}';

interface Cluster {
  statefulSet: string;
  keycloak: string;
  discovery: string;
}

/** A runner that answers each of the three reads from `cluster`, which a test may change between probes. */
function clusterRunner(cluster: Cluster) {
  return fakeRunner((_command, args) => {
    if (args.includes("statefulset")) {
      return cluster.statefulSet;
    }
    if (args.includes("keycloak")) {
      return cluster.keycloak;
    }
    return cluster.discovery;
  });
}

function settled(): Cluster {
  return {
    statefulSet: settledStatefulSet,
    keycloak: readyKeycloak,
    discovery: answering,
  };
}

function failure(stderr: string): CommandError {
  return new CommandError("kubectl", ["get", "--raw", discovery], {
    stdout: "",
    stderr,
    code: 1,
  });
}

/** Runs the probe the poll was given once and returns what it reported. */
async function probeOnce(): Promise<string | undefined> {
  const probe = vi.mocked(pollUntil).mock.calls[0]![1];
  return probe();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(pollUntil).mockResolvedValue(undefined);
  vi.mocked(errorMessage).mockImplementation((error) =>
    error instanceof Error ? error.message : String(error),
  );
});

test("with platform-keycloak-realm-wait off nothing is read from the cluster", async () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  const { runner, run } = fakeRunner();
  await waitForKeycloakRealm(repository, runner);
  expect(featureEnabled).toHaveBeenCalledWith(
    repository.environment,
    keycloakRealmWaitFlag,
  );
  expect(pollUntil).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("with the flag on the rollout and the realm's discovery are read in the configured context, bounded to five minutes, discovery through the API server's Service proxy", async () => {
  const { runner, run } = clusterRunner(settled());
  await waitForKeycloakRealm(repository, runner);
  expect(pollUntil).toHaveBeenCalledWith("5m", expect.any(Function));
  await probeOnce();
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "--namespace",
      "keycloak",
      "get",
      "statefulset",
      "keycloak",
      "--output",
      "json",
    ],
    { capture: true },
  );
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "--namespace",
      "keycloak",
      "get",
      "keycloak",
      "keycloak",
      "--output",
      "json",
    ],
    { capture: true },
  );
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    ["--context", "k3d-kore-local", "get", "--raw", discovery],
    { capture: true },
  );
});

test(`one clean read is not ready: the wait passes only after ${SETTLED_READS} in a row`, async () => {
  const { runner } = clusterRunner(settled());
  await waitForKeycloakRealm(repository, runner);
  const probe = vi.mocked(pollUntil).mock.calls[0]![1];
  const reads: (string | undefined)[] = [];
  for (let read = 0; read < SETTLED_READS; read += 1) {
    reads.push(await probe());
  }
  expect(reads.slice(0, -1).every((reason) => reason !== undefined)).toBe(true);
  expect(reads.at(-1)).toBeUndefined();
});

test("a rollout that is incomplete never passes, however often discovery answers", async () => {
  const cluster = settled();
  cluster.statefulSet = JSON.stringify({
    ...JSON.parse(settledStatefulSet),
    status: {
      observedGeneration: 4,
      replicas: 1,
      readyReplicas: 0,
      updatedReplicas: 1,
      currentRevision: "keycloak-a",
      updateRevision: "keycloak-b",
    },
  });
  const { runner, run } = clusterRunner(cluster);
  await waitForKeycloakRealm(repository, runner);
  const probe = vi.mocked(pollUntil).mock.calls[0]![1];
  for (let read = 0; read < SETTLED_READS + 2; read += 1) {
    expect(await probe()).toMatch(/StatefulSet is still rolling out/);
  }
  expect(run).not.toHaveBeenCalledWith(
    "kubectl",
    expect.arrayContaining(["--raw"]),
    expect.anything(),
  );
});

test("a StatefulSet that has not observed its latest spec is not settled", async () => {
  const cluster = settled();
  cluster.statefulSet = JSON.stringify({
    ...JSON.parse(settledStatefulSet),
    metadata: { generation: 5 },
  });
  await waitForKeycloakRealm(repository, clusterRunner(cluster).runner);
  expect(await probeOnce()).toMatch(/not yet observed/);
});

test.each([
  ["no conditions", { status: {} }, /not Ready/],
  [
    "Ready false",
    { status: { conditions: [{ type: "Ready", status: "False" }] } },
    /not Ready/,
  ],
  [
    "a RollingUpdate in progress",
    {
      status: {
        conditions: [
          { type: "Ready", status: "True" },
          { type: "RollingUpdate", status: "True" },
        ],
      },
    },
    /RollingUpdate/,
  ],
])(
  "a Keycloak resource with %s is not settled",
  async (_name, keycloak, expected) => {
    const cluster = settled();
    cluster.keycloak = JSON.stringify(keycloak);
    await waitForKeycloakRealm(repository, clusterRunner(cluster).runner);
    expect(await probeOnce()).toMatch(expected);
  },
);

test("a miss resets the count of clean reads", async () => {
  const cluster = settled();
  const { runner } = clusterRunner(cluster);
  await waitForKeycloakRealm(repository, runner);
  const probe = vi.mocked(pollUntil).mock.calls[0]![1];
  for (let read = 0; read < SETTLED_READS - 1; read += 1) {
    await probe();
  }
  cluster.discovery = "";
  expect(await probe()).toMatch(/no issuer/);
  cluster.discovery = answering;
  for (let read = 0; read < SETTLED_READS - 1; read += 1) {
    expect(await probe()).toBeDefined();
  }
  expect(await probe()).toBeUndefined();
});

test("a reply without an issuer is not ready", async () => {
  const cluster = settled();
  cluster.discovery = "";
  await waitForKeycloakRealm(repository, clusterRunner(cluster).runner);
  expect(await probeOnce()).toMatch(/no issuer/);
});

test("a reply that is not JSON for the StatefulSet fails at once", async () => {
  const cluster = settled();
  cluster.statefulSet = "not json";
  await waitForKeycloakRealm(repository, clusterRunner(cluster).runner);
  await expect(probeOnce()).rejects.toThrow(/unreadable JSON/);
});

test.each([
  "Error from server (ServiceUnavailable): the server is currently unable to handle the request (get services keycloak-service:8080)",
  'Error from server (ServiceUnavailable): no endpoints available for service "keycloak-service"',
  "Error from server (InternalError): error trying to reach service: dial tcp 10.0.0.1:8080: connect: connection refused",
])(
  "a Keycloak that is restarting is reported as not ready, not as a failure: %s",
  async (stderr) => {
    const { runner, run } = fakeRunner(() => "");
    run.mockRejectedValue(failure(stderr));
    await waitForKeycloakRealm(repository, runner);
    expect(await probeOnce()).toContain(stderr);
  },
);

test("an error that waiting cannot clear is rethrown at once", async () => {
  const { runner, run } = fakeRunner();
  const forbidden = failure(
    "Error from server (Forbidden): services is forbidden",
  );
  run.mockRejectedValue(forbidden);
  await waitForKeycloakRealm(repository, runner);
  await expect(probeOnce()).rejects.toBe(forbidden);
});

test("a rollout that never settles fails naming Keycloak, the rollout state, the last reply and the commands to run", async () => {
  vi.mocked(pollUntil).mockRejectedValue(
    new ReadinessTimeout(
      "the keycloak StatefulSet is still rolling out: 1 updated and 0 ready of 1 replicas, revision keycloak-a to keycloak-b",
    ),
  );
  const message = await waitForKeycloakRealm(
    repository,
    fakeRunner().runner,
  ).then(
    () => "",
    (error: Error) => error.message,
  );
  expect(message).toContain("Keycloak rollout");
  expect(message).toContain("5m");
  expect(message).toContain("still rolling out: 1 updated and 0 ready");
  expect(message).toContain(
    "kubectl --context k3d-kore-local --namespace keycloak get pods",
  );
  expect(message).toContain(
    "kubectl --context k3d-kore-local --namespace keycloak get statefulset,keycloak",
  );
});

test("a poll failure that is not a timeout is rethrown unchanged", async () => {
  const broken = new Error("kubeconfig is gone");
  vi.mocked(pollUntil).mockRejectedValue(broken);
  await expect(
    waitForKeycloakRealm(repository, fakeRunner().runner),
  ).rejects.toBe(broken);
});
