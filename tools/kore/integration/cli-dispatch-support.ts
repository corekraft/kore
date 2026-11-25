import { vi } from "vitest";

export const dispatch: string[] = [];

export const repository = {
  root: "/tmp/kore-cli-test",
  catalog: { components: [] },
  versions: { tools: { yq: "4.54.2" } },
  environment: {
    name: "local",
    provider: "k3d",
    kubeContext: "k3d-kore-local",
    k3d: { clusterName: "kore-local" },
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
  appUpRelease: vi.fn(async () => void dispatch.push("appUp")),
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

/** The base ref each app record check was given: undefined when --record-base was not passed. */
export const recordBases: (string | undefined)[] = [];

export const configModule = () => ({
  checkAppRecords: vi.fn(async (options) => {
    recordBases.push(options.recordBase);
    return { errors: [], warnings: [] };
  }),
  checkCrossFileRules: vi.fn(async () => ({ errors: [], warnings: [] })),
  checkOrganizationRecords: vi.fn(async () => ({
    errors: [],
    organizations: [],
  })),
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
  hostRoot: () => "/host",
  lockScope: (environment: { name: string }) => environment.name,
  withHostLease: vi.fn(async (operation: () => Promise<unknown>) =>
    operation(),
  ),
  ProcessRunner: class {},
  withHelmDeadline: (runner: unknown) => runner,
  withRequestTimeout: (runner: unknown) => runner,
  withTransientRetry: (runner: unknown) => runner,
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
  chartVersionRowPrefix: "chart:",
  // The testing barrel's app fixtures read this at import time; the dispatch specs never use its value.
  platformGeneration: () => "dispatch-generation",
  readinessFailureSummary: (evidence: {
    failures: { requirement: string; name: string; detail: string }[];
  }) =>
    evidence.failures
      .map((f) => `${f.requirement}: ${f.name} (${f.detail})`)
      .join(", "),
  closeGateIfDegraded: vi.fn(
    async () => (
      dispatch.push("closeGateIfDegraded"),
      { closed: false, failures: [], evidence: {} }
    ),
  ),
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
  composeChartDelivery: vi.fn(async (given: unknown) => given),
  upChartLockDrift: vi.fn(async (): Promise<unknown[]> => []),
  chartLockDriftMessage: vi.fn(() => ""),
  chartLockDrift: vi.fn(
    async (): Promise<unknown[]> => (
      dispatch.push("chartLockDrift"),
      [
        {
          name: "opa-authorizer",
          repository: "0.0.0-a",
          lock: "0.0.0-a",
          drift: false,
        },
      ]
    ),
  ),
  composeGoldenPathDelivery: vi.fn(async (given: unknown) => given),
  composeSuborgDelivery: vi.fn(async (given: unknown) => given),
});

export const securityModule = () => ({
  syncLocalSecrets: vi.fn(async () => (dispatch.push("syncLocalSecrets"), 2)),
  installLocalTrust: vi.fn(async () => void dispatch.push("installLocalTrust")),
  // The local internal Gateway's name; the trust install reads it as the issuer.
  trustIssuer: vi.fn(() => "kore-gateway"),
});

export const localModule = () => ({
  localDown: vi.fn(
    async (_repo, _runner, options) =>
      void dispatch.push(`localDown:${options.prune}:${options.purgeData}`),
  ),
  localUp: vi.fn(async () => void dispatch.push("localUp")),
  // The platform-dns flag is off in the fixture, so the wrapper only runs the work.
  withHostResolver: vi.fn(async (_repo, _runner, work) => await work()),
});

export const imagesModule = async () => ({
  ...(await vi.importActual<object>("../src/images/index.js")),
  swapLocalSigningKey: vi.fn(async (_repo, _runner, options) => {
    dispatch.push(`swapLocalSigningKey:${options.yes}`);
  }),
  rotateRegistryCredentials: vi.fn(async (_repo, _runner, options) => {
    dispatch.push(`rotateRegistryCredentials:${options.yes}`);
    return { namespaces: ["reference"] };
  }),
});
