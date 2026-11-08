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
  readJournal: vi.fn(async () => (dispatch.push("readJournal"), [])),
  summarizeOperations: vi.fn(() => [
    {
      op: "a",
      command: "local up",
      ts: "2026-11-07T10:00:00.000Z",
      outcome: "interrupted",
    },
    {
      op: "b",
      command: "cluster stop",
      ts: "2026-11-07T10:01:00.000Z",
      outcome: "ok",
      ms: 5,
    },
  ]),
  withJournal: vi.fn(async (operation, runner, work) => {
    dispatch.push(`journal:${operation.command}:${operation.context}`);
    return work(runner);
  }),
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
  localDown: vi.fn(
    async (_repo, _runner, options) =>
      void dispatch.push(`localDown:${options.prune}:${options.purgeData}`),
  ),
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
    "journal:cluster up:kore-local",
    "clusterUp",
    "lock",
    "journal:cluster stop:kore-local",
    "clusterStop",
    "lock",
    "journal:cluster destroy:kore-local",
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
    "journal:platform bootstrap:kore-local",
    "bootstrapControllers",
    "lock",
    "journal:platform up:kore-local",
    "platformUp",
    "lock",
    "journal:platform stop:kore-local",
    "platformStop",
    "lock",
    "journal:platform destroy:kore-local",
    "platformDestroy",
  ]);
});

test("application and local CLI commands dispatch deploy and teardown actions", async () => {
  await main(["app", "up", "reference", "--environment", "local"]);
  await main(["app", "down", "reference", "--environment", "local"]);
  await main(["local", "up", "--environment", "local"]);
  await main(["local", "down", "--environment", "local", "--prune"]);
  await main([
    "local",
    "down",
    "--environment",
    "local",
    "--prune",
    "--purge-data",
  ]);

  expect(dispatch).toEqual([
    "lock",
    "journal:app up reference:kore-local",
    "appUp",
    "lock",
    "journal:app down reference:kore-local",
    "appDown",
    "lock",
    "journal:local up:kore-local",
    "localUp",
    "lock",
    "journal:local down:kore-local",
    "localDown:true:false",
    "lock",
    "journal:local down:kore-local",
    "localDown:true:true",
  ]);
});

test("tunnel, secret, and trust CLI mutations dispatch their operations", async () => {
  await main(["tunnel", "start", "--environment", "local", "--json"]);
  await main(["tunnel", "stop", "--environment", "local", "--json"]);
  await main(["secrets", "sync", "--environment", "local", "--json"]);
  await main(["trust", "install", "--environment", "local", "--json"]);

  expect(dispatch).toEqual([
    "lock",
    "journal:tunnel start:kore-local",
    "startLocalTunnel",
    "lock",
    "journal:tunnel stop:kore-local",
    "stopLocalTunnel",
    "lock",
    "journal:secrets sync:kore-local",
    "syncLocalSecrets",
    "lock",
    "journal:trust install:kore-local",
    "installLocalTrust",
  ]);
});

test("CLI rejects unknown commands, missing environments, and unsupported actions", async () => {
  await expect(main(["unrecognized"])).rejects.toThrow(/unknown command/);
  await expect(
    main(["cluster", "nope", "--environment", "local"]),
  ).rejects.toThrow(/unknown cluster action/);
  await expect(
    main(["platform", "nope", "--environment", "local"]),
  ).rejects.toThrow(/unknown platform action/);
  await expect(
    main(["app", "publish", "reference", "--environment", "local"]),
  ).rejects.toThrow(/unknown app action/);
  await expect(
    main(["local", "restart", "--environment", "local"]),
  ).rejects.toThrow(/unknown local action/);
  await expect(
    main(["tunnel", "restart", "--environment", "local"]),
  ).rejects.toThrow(/unknown tunnel action/);
  await expect(
    main(["secrets", "rotate", "--environment", "local"]),
  ).rejects.toThrow(/unknown secrets action/);
  await expect(
    main(["trust", "remove", "--environment", "local"]),
  ).rejects.toThrow(/unknown trust action/);
  await expect(
    main(["app", "status", "--environment", "local"]),
  ).rejects.toThrow(/application name is required/);
  await expect(main(["app", "up", "reference"])).rejects.toThrow(
    /--environment is required for mutating commands/,
  );
});

test("unknown actions fail before taking the lock or writing a journal entry", async () => {
  for (const argv of [
    ["cluster", "nope"],
    ["platform", "nope"],
    ["app", "restart", "reference"],
    ["local", "restart"],
    ["tunnel", "restart"],
    ["secrets", "rotate"],
    ["trust", "remove"],
  ]) {
    dispatch.length = 0;
    await expect(main([...argv, "--environment", "local"])).rejects.toThrow(
      /unknown \w+ action/,
    );
    expect(dispatch, argv.join(" ")).toEqual([]);
  }
});

test("journal CLI command reads the journal without locking or mutating", async () => {
  const write = vi.spyOn(process.stdout, "write");
  expect(await main(["journal", "--environment", "local", "--json"])).toBe(0);
  expect(dispatch).toEqual(["readJournal"]);
  const output = JSON.parse(String(write.mock.calls[0]![0])) as {
    operations: { op: string; outcome: string }[];
    interrupted: number;
  };
  expect(output.interrupted).toBe(1);
  expect(output.operations.map((op) => op.outcome)).toEqual([
    "interrupted",
    "ok",
  ]);
});

test("journal CLI command limits output to the most recent operations", async () => {
  const write = vi.spyOn(process.stdout, "write");
  await main(["journal", "--limit", "1", "--json"]);
  const output = JSON.parse(String(write.mock.calls[0]![0])) as {
    operations: { op: string }[];
  };
  expect(output.operations.map((op) => op.op)).toEqual(["b"]);
  await expect(main(["journal", "--limit", "zero"])).rejects.toThrow(
    /--limit must be a positive integer/,
  );
});

test("read-only commands never open a journal entry", async () => {
  await main(["cluster", "status"]);
  await main(["platform", "render"]);
  await main(["doctor"]);
  expect(dispatch.some((item) => item.startsWith("journal:"))).toBe(false);
});
