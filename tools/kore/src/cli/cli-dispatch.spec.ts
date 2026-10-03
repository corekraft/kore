import { afterEach, beforeEach, expect, test, vi } from "vitest";

const dispatch = vi.hoisted(() => [] as string[]);
const repository = vi.hoisted(() => ({
  root: "/tmp/kore-cli-test",
  catalog: { components: [] },
  environment: {
    name: "local",
    provider: "minikube",
    kubeContext: "kore-local",
    cluster: { profile: "kore-local" },
    gateway: { name: "kore-gateway" },
  },
}));

vi.mock("../app/index.js", () => ({
  appDown: vi.fn(async () => void dispatch.push("appDown")),
  appStatus: vi.fn(
    async () => (dispatch.push("appStatus"), { status: "ready" }),
  ),
  appUp: vi.fn(async () => void dispatch.push("appUp")),
}));
vi.mock("../cluster/index.js", () => ({
  clusterDestroy: vi.fn(
    async (_repo, _runner, options) =>
      void dispatch.push(`clusterDestroy:${options.yes}:${options.purgeData}`),
  ),
  clusterStatus: vi.fn(
    async () => (dispatch.push("clusterStatus"), { status: "running" }),
  ),
  clusterStop: vi.fn(async () => void dispatch.push("clusterStop")),
  clusterUp: vi.fn(async () => void dispatch.push("clusterUp")),
}));
vi.mock("../config/index.js", () => ({
  loadRepository: vi.fn(async (environment) => ({
    ...repository,
    environment: { ...repository.environment, name: environment },
  })),
  orderedComponents: vi.fn(() => [{ name: "gateway" }]),
}));
vi.mock("../diagnostics/index.js", () => ({
  doctor: vi.fn(async () => (dispatch.push("doctor"), [{ status: "ready" }])),
  doctorFailed: vi.fn(() => false),
  validatePortability: vi.fn(
    async () => (
      dispatch.push("validatePortability"),
      { applications: ["reference"] }
    ),
  ),
}));
vi.mock("../runtime/index.js", () => ({
  ProcessRunner: class {},
  withEnvironmentLock: vi.fn(async (_root, _environment, operation) => {
    dispatch.push("lock");
    return operation();
  }),
}));
vi.mock("../platform/index.js", () => ({
  bootstrapControllers: vi.fn(
    async () => void dispatch.push("bootstrapControllers"),
  ),
  platformDestroy: vi.fn(async () => void dispatch.push("platformDestroy")),
  platformRender: vi.fn(async () => void dispatch.push("platformRender")),
  platformStatus: vi.fn(async () => (dispatch.push("platformStatus"), [])),
  platformStop: vi.fn(async () => void dispatch.push("platformStop")),
  platformUp: vi.fn(async () => void dispatch.push("platformUp")),
}));
vi.mock("../security/index.js", () => ({
  syncLocalSecrets: vi.fn(async () => (dispatch.push("syncLocalSecrets"), 2)),
  installLocalTrust: vi.fn(async () => void dispatch.push("installLocalTrust")),
}));
vi.mock("../tunnel/index.js", () => ({
  startLocalTunnel: vi.fn(
    async () => (dispatch.push("startLocalTunnel"), { status: "running" }),
  ),
  stopLocalTunnel: vi.fn(async () => void dispatch.push("stopLocalTunnel")),
  tunnelStatus: vi.fn(
    async () => (dispatch.push("tunnelStatus"), { status: "running" }),
  ),
}));
vi.mock("../local/index.js", () => ({
  localDown: vi.fn(async () => void dispatch.push("localDown")),
  localUp: vi.fn(async () => void dispatch.push("localUp")),
}));

import { main } from "./cli.js";

beforeEach(() => {
  dispatch.length = 0;
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("read-only CLI commands dispatch doctor, validation, and status", async () => {
  expect(await main(["validate", "--json"])).toBe(0);
  expect(await main(["doctor", "--json"])).toBe(0);
  expect(await main(["cluster", "status", "--json"])).toBe(0);
  expect(await main(["platform", "status", "--json"])).toBe(0);
  expect(await main(["app", "status", "reference", "--json"])).toBe(0);
  expect(await main(["tunnel", "status", "--json"])).toBe(0);
  expect(dispatch).toEqual([
    "validatePortability",
    "doctor",
    "clusterStatus",
    "platformStatus",
    "appStatus",
    "tunnelStatus",
  ]);
});

test("cluster CLI commands dispatch guarded mutations and destroy options", async () => {
  await main(["cluster", "up", "--environment", "local"]);
  await main(["cluster", "stop", "--environment", "local"]);
  await main([
    "cluster",
    "destroy",
    "--environment",
    "local",
    "--yes",
    "--purge-data",
  ]);

  expect(dispatch).toEqual([
    "lock",
    "clusterUp",
    "lock",
    "clusterStop",
    "lock",
    "clusterDestroy:true:true",
  ]);
});

test("platform CLI commands dispatch render and all lifecycle actions", async () => {
  await main([
    "platform",
    "render",
    "--environment",
    "local",
    "--output",
    "/tmp/render",
  ]);
  await main(["platform", "bootstrap", "--environment", "local"]);
  await main(["platform", "up", "--environment", "local"]);
  await main(["platform", "stop", "--environment", "local"]);
  await main([
    "platform",
    "destroy",
    "--environment",
    "local",
    "--yes",
    "--purge-data",
  ]);

  expect(dispatch).toEqual([
    "platformRender",
    "lock",
    "bootstrapControllers",
    "lock",
    "platformUp",
    "lock",
    "platformStop",
    "lock",
    "platformDestroy",
  ]);
});

test("application and local CLI commands dispatch deploy and teardown actions", async () => {
  await main(["app", "up", "reference", "--environment", "local"]);
  await main(["app", "down", "reference", "--environment", "local"]);
  await main(["local", "up", "--environment", "local"]);
  await main(["local", "down", "--environment", "local", "--prune"]);

  expect(dispatch).toEqual([
    "lock",
    "appUp",
    "lock",
    "appDown",
    "lock",
    "localUp",
    "lock",
    "localDown",
  ]);
});

test("tunnel, secret, and trust CLI mutations dispatch their operations", async () => {
  await main(["tunnel", "start", "--environment", "local", "--json"]);
  await main(["tunnel", "stop", "--environment", "local", "--json"]);
  await main(["secrets", "sync", "--environment", "local", "--json"]);
  await main(["trust", "install", "--environment", "local", "--json"]);

  expect(dispatch).toEqual([
    "lock",
    "startLocalTunnel",
    "lock",
    "stopLocalTunnel",
    "lock",
    "syncLocalSecrets",
    "lock",
    "installLocalTrust",
  ]);
});
