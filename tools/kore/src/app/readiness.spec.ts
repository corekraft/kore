// Docs: docs/decisions/0054-application-admission-gate-closed-at-foundation.md
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { assertExpectedCluster } from "../cluster/index.js";
import {
  assertAdmissionGateOpen,
  platformStatus,
  waitForHTTPRoute,
} from "../platform/index.js";
import { fakeRepository, fakeRunner } from "./app-support.js";
import {
  assertAppAdmissible,
  assertPlatformReady,
  httpRouteNames,
  waitForResources,
  waitForRollouts,
  waitForRoutes,
  waitForSecretSource,
} from "./readiness.js";
import {
  component,
  kubectl,
  readinessDefaults,
  fakeHash,
  fresh,
  rotatedAt,
  rotationId,
  routeManifest,
  secretRunner,
  stale,
} from "./readiness-support.js";

vi.mock("node:crypto");
vi.mock("../cluster/index.js");
vi.mock("../platform/index.js");

const name = "reference";
const context = "k3d-kore-local";
const scope = ["--context", context, "--namespace", name];
const repository = fakeRepository();
const bounded = { timeoutMs: 5000, intervalMs: 1000 };
beforeEach(() => {
  // Date and setTimeout run on the fake clock, so the wait loop never sleeps.
  vi.useFakeTimers({ toFake: ["Date", "setTimeout"] });
  vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
  readinessDefaults();
});

afterEach(() => {
  vi.useRealTimers();
});

test("platform readiness refuses, naming each component that is not ready with its detail", async () => {
  vi.mocked(platformStatus).mockResolvedValue([
    component("oci-registry", "degraded", "no endpoints"),
    component("policy-controller", "pending", "starting"),
  ]);
  const { runner } = fakeRunner();
  await expect(assertPlatformReady(repository, runner)).rejects.toThrow(
    "platform is not ready: oci-registry (no endpoints), policy-controller (starting)",
  );
});

test("platform readiness ignores the admission gate and the image inventory, which are checked where they apply, and gated-off components", async () => {
  vi.mocked(platformStatus).mockResolvedValue([
    component("application-admission-gate", "closed"),
    component("image-inventory", "degraded"),
    component("crossplane", "gated-off"),
  ]);
  const { runner } = fakeRunner();
  await expect(
    assertPlatformReady(repository, runner),
  ).resolves.toBeUndefined();
});

test("application admission returns the open gate's generation, after checking the cluster and then the platform", async () => {
  const { runner } = fakeRunner();
  await expect(assertAppAdmissible(repository, runner)).resolves.toBe("g-abc");
  expect(assertAdmissionGateOpen).toHaveBeenCalledWith(repository, runner);
  const cluster =
    vi.mocked(assertExpectedCluster).mock.invocationCallOrder[0] ?? 0;
  expect(cluster).toBeLessThan(
    vi.mocked(platformStatus).mock.invocationCallOrder[0] ?? 0,
  );
  expect(
    vi.mocked(platformStatus).mock.invocationCallOrder[0] ?? 0,
  ).toBeLessThan(
    vi.mocked(assertAdmissionGateOpen).mock.invocationCallOrder[0] ?? 0,
  );
});
test("application admission refuses before reading the gate when the cluster is wrong or the platform is closed", async () => {
  const { runner } = fakeRunner();
  vi.mocked(assertExpectedCluster).mockRejectedValueOnce(
    new Error("wrong context"),
  );
  await expect(assertAppAdmissible(repository, runner)).rejects.toThrow(
    "wrong context",
  );
  expect(platformStatus).not.toHaveBeenCalled();
  vi.mocked(platformStatus).mockResolvedValue([
    component("oci-registry", "degraded", "down"),
  ]);
  await expect(assertAppAdmissible(repository, runner)).rejects.toThrow(
    /oci-registry \(down\)/,
  );
  expect(assertAdmissionGateOpen).not.toHaveBeenCalled();
});

test("the resources wait blocks on Ready PostgreSQL instances, then on the secrets, in the application namespace", async () => {
  const { runner, run } = fakeRunner();
  await waitForResources(repository, runner, name);
  expect(run.mock.calls).toEqual([
    kubectl([
      ...scope,
      "wait",
      "--for=condition=Ready",
      "postgresqlinstances.platform.kore.dev",
      "--all",
      "--timeout=15m",
    ]),
    kubectl([
      ...scope,
      "wait",
      "--for=jsonpath={.data}",
      "secret",
      "--selector",
      `app.kubernetes.io/part-of=${name}`,
      "--timeout=5m",
    ]),
  ]);
});

test("a database that never becomes Ready stops the wait before any secret is awaited", async () => {
  const { runner, run } = fakeRunner();
  run.mockRejectedValueOnce(new Error("timed out waiting for the condition"));
  await expect(waitForResources(repository, runner, name)).rejects.toThrow(
    "timed out",
  );
  expect(run).toHaveBeenCalledTimes(1);
});

test("rollouts wait on every deployment the namespace lists, naming each without its API prefix", async () => {
  const { runner, run } = fakeRunner((_command, args) =>
    args.includes("--output=name")
      ? "deployment/api\ndeployment.apps/worker\n"
      : "",
  );
  await waitForRollouts(repository, runner, name);
  expect(run.mock.calls).toEqual([
    kubectl([...scope, "get", "deployment", "--output=name"], true),
    kubectl([...scope, "rollout", "status", "deployment/api", "--timeout=10m"]),
    kubectl([
      ...scope,
      "rollout",
      "status",
      "deployment/worker",
      "--timeout=10m",
    ]),
  ]);
  run.mockClear();
  vi.mocked(run).mockResolvedValue({ stdout: "", stderr: "", code: 0 });
  await waitForRollouts(repository, runner, name);
  expect(run.mock.calls).toEqual([
    kubectl([...scope, "get", "deployment", "--output=name"], true),
  ]);
});

test("route names are read from block and flow style metadata alike, skipping documents that are not routes", () => {
  expect(
    httpRouteNames(
      '---\nkind: HTTPRoute\nmetadata: {name: reference}\n---\nkind: HTTPRoute\nmetadata:\n  labels: {a: b}\n  name: "other"\n---\nkind: Service\nmetadata: {name: skipped}\n',
    ),
  ).toEqual(["reference", "other"]);
});

test("the routes wait reads each release's rendered routes, the resources release first, and waits on each with five minutes", async () => {
  const { runner, run } = fakeRunner((_command, args) =>
    args[2] === `${name}-resources`
      ? routeManifest("admin")
      : routeManifest("web"),
  );
  await waitForRoutes(repository, runner, name);
  const get = (release: string) => [
    "get",
    "manifest",
    release,
    "--namespace",
    name,
    "--kube-context",
    context,
  ];
  expect(run.mock.calls.map((call) => call[1])).toEqual([
    get(`${name}-resources`),
    get(name),
  ]);
  expect(vi.mocked(waitForHTTPRoute).mock.calls).toEqual([
    [runner, scope, "httproute/admin", "5m"],
    [runner, scope, "httproute/web", "5m"],
  ]);
  await waitForRoutes(repository, runner, name, "1s");
  expect(waitForHTTPRoute).toHaveBeenLastCalledWith(
    runner,
    scope,
    "httproute/web",
    "1s",
  );
});

test("a route that stays unresolved fails naming the route, the namespace and the unmet condition, not a bare timeout", async () => {
  vi.mocked(waitForHTTPRoute).mockRejectedValue(
    new Error("ResolvedRefs is False (reason: BackendNotFound)"),
  );
  const { runner } = fakeRunner(() => routeManifest("web"));
  await expect(waitForRoutes(repository, runner, name)).rejects.toThrow(
    "httproute/web in namespace reference is not ready: ResolvedRefs is False (reason: BackendNotFound)",
  );
});

test("an application that renders no route waits on none", async () => {
  const { runner } = fakeRunner(() => "");
  await waitForRoutes(repository, runner, name);
  expect(waitForHTTPRoute).not.toHaveBeenCalled();
});

test("a Secret already synced after the rotation is not resynced", async () => {
  const hash = fakeHash("ab".repeat(32));
  const { runner, run } = secretRunner(
    `${rotationId}|${rotatedAt}`,
    () => fresh,
  );
  await expect(
    waitForSecretSource(repository, runner, name, bounded),
  ).resolves.toBe("abababababababab");
  expect(run.mock.calls.some(([, args]) => args.includes("annotate"))).toBe(
    false,
  );
  expect(createHash).toHaveBeenCalledWith("sha256");
  expect(hash.update).toHaveBeenCalledWith(rotationId);
});

test("a stale Secret is resynced through its ExternalSecret and awaited, bounded, before the version is returned", async () => {
  fakeHash("ab".repeat(32));
  const { runner, run } = secretRunner(`${rotationId}|${rotatedAt}`, (probe) =>
    probe < 3 ? stale : fresh,
  );
  const pending = waitForSecretSource(repository, runner, name, bounded);
  await vi.runAllTimersAsync();
  await expect(pending).resolves.toBe("abababababababab");
  const annotations = run.mock.calls.filter(([, args]) =>
    args.includes("annotate"),
  );
  expect(annotations.map(([, args]) => args)).toEqual([
    [
      ...scope,
      "annotate",
      "externalsecret",
      `${name}-app`,
      `force-sync=${Date.parse("2026-11-09T10:00:00Z")}`,
      "--overwrite",
    ],
  ]);
});

test("a Secret that never syncs fails naming the ExternalSecret and its condition, with the fix", async () => {
  fakeHash("ab".repeat(32));
  const { runner } = secretRunner(
    `${rotationId}|${rotatedAt}`,
    () => "2026-11-09T09:59:59Z|False|SecretSyncedError",
  );
  const pending = waitForSecretSource(repository, runner, name, bounded);
  const failed = expect(pending).rejects.toThrow(
    /ExternalSecret reference\/reference-app.*Ready=False reason=SecretSyncedError.*rerun kore app up/s,
  );
  await vi.runAllTimersAsync();
  await failed;
});

test("a source with no rotation id waits for nothing and returns no version", async () => {
  const { runner, run } = secretRunner("|", () => stale);
  await expect(
    waitForSecretSource(repository, runner, name, bounded),
  ).resolves.toBe("");
  expect(
    run.mock.calls.some(([, args]) => args.includes("externalsecret")),
  ).toBe(false);
});

test("the Secret wait reads only metadata and status, never secret data", async () => {
  fakeHash("ab".repeat(32));
  const { runner, run } = secretRunner(
    `${rotationId}|${rotatedAt}`,
    () => fresh,
  );
  await waitForSecretSource(repository, runner, name, bounded);
  for (const [, args] of run.mock.calls) {
    const joined = args.join(" ");
    expect(joined).not.toMatch(
      /\.data|-o ?(yaml|json)\b|--output[ =](yaml|json)\b/,
    );
    expect(joined).toMatch(/metadata\.annotations|status\./);
  }
});
