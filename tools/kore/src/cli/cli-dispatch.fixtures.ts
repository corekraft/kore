import { vi } from "vitest";

export const dispatch: string[] = [];

export const repository = {
  root: "/tmp/kore-cli-test",
  catalog: { components: [] },
  environment: {
    name: "local",
    provider: "minikube",
    kubeContext: "kore-local",
    cluster: { profile: "kore-local" },
    gateway: { name: "kore-gateway" },
  },
};

export const appModule = () => ({
  appDown: vi.fn(async () => {
    dispatch.push("appDown");
    return { retained: [], warnings: [] };
  }),
  appStatus: vi.fn(
    async () => (dispatch.push("appStatus"), { status: "ready" }),
  ),
  appUp: vi.fn(async () => void dispatch.push("appUp")),
});

export const clusterModule = () => ({
  clusterDestroy: vi.fn(
    async (_repo, _runner, options) =>
      void dispatch.push(`clusterDestroy:${options.yes}:${options.purgeData}`),
  ),
  clusterStatus: vi.fn(
    async () => (dispatch.push("clusterStatus"), { status: "running" }),
  ),
  clusterStop: vi.fn(async () => void dispatch.push("clusterStop")),
  clusterUp: vi.fn(async () => void dispatch.push("clusterUp")),
  exportRetainedData: vi.fn(async (_repo, _runner, options) => {
    dispatch.push(`exportRetainedData:${options.namespace}`);
    return { exports: [] };
  }),
  restoreRetainedData: vi.fn(async (_repo, _runner, options) => {
    dispatch.push(
      `restoreRetainedData:${options.from}:${options.identity}:${options.overwriteData}:${options.yes}`,
    );
    return { restored: true, cluster: "pg", database: "app" };
  }),
});

export const configModule = () => ({
  loadRepository: vi.fn(async (environment) => ({
    ...repository,
    environment: { ...repository.environment, name: environment },
  })),
  orderedComponents: vi.fn(() => [{ name: "gateway" }]),
});

export const diagnosticsModule = () => ({
  doctor: vi.fn(async () => (dispatch.push("doctor"), [{ status: "ready" }])),
  doctorFailed: vi.fn(() => false),
  validatePortability: vi.fn(
    async () => (
      dispatch.push("validatePortability"),
      { applications: ["reference"] }
    ),
  ),
});

export const runtimeModule = () => ({
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
});

export const platformModule = () => ({
  bootstrapControllers: vi.fn(
    async () => void dispatch.push("bootstrapControllers"),
  ),
  platformDestroy: vi.fn(async () => void dispatch.push("platformDestroy")),
  platformRender: vi.fn(async () => void dispatch.push("platformRender")),
  platformStatusReport: vi.fn(
    async () => (dispatch.push("platformStatusReport"), []),
  ),
  platformStatus: vi.fn(
    async (): Promise<unknown[]> => (dispatch.push("platformStatus"), []),
  ),
  platformStop: vi.fn(async () => void dispatch.push("platformStop")),
  platformUp: vi.fn(async () => void dispatch.push("platformUp")),
});

export const securityModule = () => ({
  syncLocalSecrets: vi.fn(async () => (dispatch.push("syncLocalSecrets"), 2)),
  installLocalTrust: vi.fn(async () => void dispatch.push("installLocalTrust")),
});

export const tunnelModule = () => ({
  startLocalTunnel: vi.fn(
    async () => (dispatch.push("startLocalTunnel"), { status: "running" }),
  ),
  stopLocalTunnel: vi.fn(async () => void dispatch.push("stopLocalTunnel")),
  tunnelStatus: vi.fn(
    async () => (dispatch.push("tunnelStatus"), { status: "running" }),
  ),
});

export const localModule = () => ({
  localDown: vi.fn(
    async (_repo, _runner, options) =>
      void dispatch.push(`localDown:${options.prune}:${options.purgeData}`),
  ),
  localUp: vi.fn(async () => void dispatch.push("localUp")),
});

export const imagesModule = async () => ({
  ...(await vi.importActual<object>("../images/index.js")),
  rotateRegistryCredentials: vi.fn(async (_repo, _runner, options) => {
    dispatch.push(`rotateRegistryCredentials:${options.yes}`);
    return { namespaces: ["reference"] };
  }),
});
