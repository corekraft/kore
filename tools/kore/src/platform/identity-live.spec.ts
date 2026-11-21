import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { assertExpectedCluster } from "../cluster/index.js";
import { findRoot, loadRepository, platformPlan } from "../config/index.js";
import { liveEnvironment, ProcessRunner } from "../runtime/index.js";
import {
  constraints,
  decisionLogArguments,
  kubectl,
  live,
  opaNamespace,
  read,
  setup,
  viaGateway,
} from "./identity-live.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";

// Live helpers for identity.live.spec.ts. These unit tests fake the cluster,
// the runner and the filesystem; nothing here reads a Secret or a cluster.

const fs = vi.hoisted(() => ({
  readdir: vi.fn<(dir: string) => Promise<string[]>>(),
  readFile: vi.fn<(path: string) => Promise<string>>(),
}));
vi.mock("node:fs/promises", () => fs);
vi.mock("../cluster/index.js", () => ({ assertExpectedCluster: vi.fn() }));
vi.mock("../config/index.js", () => ({
  gatewayEntryPort: 443,
  findRoot: vi.fn(),
  loadRepository: vi.fn(),
  platformPlan: vi.fn(),
}));
vi.mock("../runtime/index.js", () => ({
  ProcessRunner: vi.fn(),
  liveEnvironment: vi.fn(),
}));

/** A fake repository with a gateway and a catalog; the catalog holds the given components. */
function repositoryWith(components = [fakeComponent({ name: "reference" })]) {
  return Object.assign(fakeRepository({ gateway: { port: 8443 } }), {
    catalog: { components },
  });
}

const repository = repositoryWith();

beforeEach(() => {
  vi.mocked(findRoot).mockResolvedValue("/repo");
  vi.mocked(liveEnvironment).mockReturnValue("local");
  vi.mocked(platformPlan).mockReturnValue({
    domain: "kore.internal",
    organizationId: "platform",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("setup loads the live environment for the discovered root and checks the expected cluster first", async () => {
  const { runner } = fakeRunner();
  vi.mocked(ProcessRunner).mockImplementation(function () {
    return runner as ProcessRunner;
  });
  vi.mocked(loadRepository).mockResolvedValue(repository);

  const context = await setup();

  expect(loadRepository).toHaveBeenCalledWith("local", "/repo");
  expect(assertExpectedCluster).toHaveBeenCalledWith(repository, runner);
  expect(context).toEqual({ repository, runner });
});

test("kubectl pins every call to the repository's configured context", () => {
  expect(kubectl(repository, "get", "pods")).toEqual([
    "--context",
    "k3d-kore-local",
    "get",
    "pods",
  ]);
});

test("read runs kubectl with captured output and returns its stdout", async () => {
  const { runner, run } = fakeRunner(() => "pod-list");

  await expect(read(repository, runner, "get", "pods")).resolves.toBe(
    "pod-list",
  );
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    ["--context", "k3d-kore-local", "get", "pods"],
    { capture: true },
  );
});

test("the OPA namespace comes from the catalog and defaults to opa-system", () => {
  const withOpa = repositoryWith([
    fakeComponent({ name: "opa-authorizer", namespace: "policy-system" }),
  ]);
  expect(opaNamespace(withOpa)).toBe("policy-system");
  expect(opaNamespace(repository)).toBe("opa-system");
});

test("decision logs are read from every authorizer pod, bounded in time and lines", () => {
  expect(decisionLogArguments("opa-system")).toEqual([
    "--namespace",
    "opa-system",
    "logs",
    "--selector=app.kubernetes.io/name=opa-authorizer",
    "--max-log-requests=10",
    "--tail=-1",
    "--since=2m",
  ]);
});

test("a request through the Gateway resolves the local host and returns the HTTP status", async () => {
  const { runner, run } = fakeRunner(() => "403\n");

  await expect(viaGateway(repository, runner, "/api/protected")).resolves.toBe(
    403,
  );
  expect(run).toHaveBeenCalledWith(
    "curl",
    [
      "--insecure",
      "--silent",
      "--output",
      "/dev/null",
      "--write-out",
      "%{http_code}",
      "--resolve",
      "kore.internal:443:127.0.0.1",
      "https://kore.internal:443/api/protected",
    ],
    { capture: true },
  );
});

test("an authorization header is sent only when one is given", async () => {
  const { runner, run } = fakeRunner(() => "200\n");

  await viaGateway(repository, runner, "/api", "Bearer t");

  expect(run.mock.calls[0]?.[1]).toEqual(
    expect.arrayContaining(["--header", "Authorization: Bearer t"]),
  );
});

test("constraints are read from the Gatekeeper directory, one YAML file each, by kind and name", async () => {
  fs.readdir.mockResolvedValue(["b.yaml", "notes.md", "a.yaml"]);
  fs.readFile.mockImplementation(async (path) =>
    String(path).endsWith("a.yaml")
      ? "kind: K8sRequiredLabels\nmetadata: {name: must-have-owner, labels: x}\n"
      : "kind: K8sDenyTag\nmetadata: {name: no-latest}\n",
  );

  await expect(constraints(repository)).resolves.toEqual([
    { kind: "K8sDenyTag", name: "no-latest" },
    { kind: "K8sRequiredLabels", name: "must-have-owner" },
  ]);
  expect(fs.readdir).toHaveBeenCalledWith(
    "/repo/infra/policies/gatekeeper/constraints",
  );
});

test("the live suite is skipped unless KORE_RUN_LIVE is 1, and carries a ten-minute timeout", async () => {
  expect(live.timeout).toBe(10 * 60 * 1000);
  vi.stubEnv("KORE_RUN_LIVE", "0");
  vi.resetModules();
  const skipped = await import("./identity-live.js");
  expect(skipped.live.skip).toBe(
    "set KORE_RUN_LIVE=1 to opt into a live local profile",
  );
  vi.stubEnv("KORE_RUN_LIVE", "1");
  vi.resetModules();
  const enabled = await import("./identity-live.js");
  expect(enabled.live.skip).toBe(false);
});
