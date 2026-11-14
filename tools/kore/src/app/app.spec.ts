// Docs: docs/decisions/0035-fail-fast-readiness-diagnosis.md
import { beforeEach, expect, test, vi } from "vitest";
import { assertExpectedCluster, retainedResources } from "../cluster/index.js";
import { platformStatus } from "../platform/index.js";
import { appDown, appStatus } from "./app.js";
import { deployedImage } from "./deployed.js";
import { lockedImageForStatus } from "./image-source.js";
import { fakeImage, fakeRepository, fakeRunner } from "./app-support.js";

vi.mock("../cluster/index.js");
vi.mock("../platform/index.js");
vi.mock("./deployed.js");
vi.mock("./image-source.js");

const name = "reference";
const repository = fakeRepository();
const context = "k3d-kore-local";
const admission = ["oci-registry", "policy-controller"];
const releases =
  (stdout: string) => (command: string, args: readonly string[]) =>
    command === "helm" && args[1] === `${name}-resources`
      ? '{"release":"resources"}'
      : stdout;

beforeEach(() => {
  vi.mocked(assertExpectedCluster).mockResolvedValue();
  vi.mocked(retainedResources).mockResolvedValue([]);
  vi.mocked(lockedImageForStatus).mockResolvedValue(fakeImage());
  vi.mocked(deployedImage).mockResolvedValue({ digest: "sha256:x" } as never);
  vi.mocked(platformStatus).mockResolvedValue([
    {
      name: "oci-registry",
      namespace: "kore-registry",
      status: "ready",
      detail: "",
    },
    {
      name: "policy-controller",
      namespace: "cosign-system",
      status: "ready",
      detail: "",
    },
  ] as never);
});

test("status is ready when the registry and the policy controller that admit new workloads are ready", async () => {
  const { runner } = fakeRunner(releases('{"workload":true}'));
  const status = await appStatus(repository, runner, name);
  expect(platformStatus).toHaveBeenCalledWith(repository, runner, admission);
  expect(status).toMatchObject({ name, status: "ready", degraded: [] });
});

test("status is degraded and names each admission component that is not ready, with its namespace and detail", async () => {
  vi.mocked(platformStatus).mockResolvedValue([
    {
      name: "oci-registry",
      namespace: "kore-registry",
      status: "degraded",
      detail: "deployment/oci-registry",
    },
    {
      name: "policy-controller",
      namespace: "cosign-system",
      status: "ready",
      detail: "",
    },
  ] as never);
  const { runner } = fakeRunner(releases("{}"));
  const status = await appStatus(repository, runner, name);
  expect(status).toMatchObject({
    status: "degraded",
    degraded: [
      {
        component: "oci-registry",
        namespace: "kore-registry",
        detail: "deployment/oci-registry",
      },
    ],
  });
});

test("status reports the lock image, the deployed image, and each release as Helm reports it", async () => {
  const { runner } = fakeRunner((_command, args) =>
    args[1] === `${name}-resources`
      ? '{"release":"resources"}'
      : '{"release":"workload"}',
  );
  const status = await appStatus(repository, runner, name);
  expect(lockedImageForStatus).toHaveBeenCalledWith(repository, name);
  expect(deployedImage).toHaveBeenCalledWith(
    repository,
    runner,
    name,
    fakeImage(),
  );
  expect(status).toMatchObject({
    image: fakeImage(),
    deployed: { digest: "sha256:x" },
    resources: { release: "resources" },
    workload: { release: "workload" },
  });
});

test("status only reads: it asks Helm for the two releases and changes nothing", async () => {
  const { runner, run } = fakeRunner(releases("{}"));
  await appStatus(repository, runner, name);
  expect(
    run.mock.calls.map(([command, args]) => [command, ...args.slice(0, 2)]),
  ).toEqual([
    ["helm", "status", `${name}-resources`],
    ["helm", "status", name],
  ]);
  expect(JSON.stringify(run.mock.calls)).not.toMatch(
    /apply|upgrade|uninstall|delete|patch/,
  );
});

test("status refuses on the wrong cluster before reading the lock, the platform or any release", async () => {
  vi.mocked(assertExpectedCluster).mockRejectedValue(
    new Error("wrong context"),
  );
  const { runner, run } = fakeRunner();
  await expect(appStatus(repository, runner, name)).rejects.toThrow(
    "wrong context",
  );
  expect(lockedImageForStatus).not.toHaveBeenCalled();
  expect(platformStatus).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("down uninstalls only the workload release, in the configured context, waiting for it to finish", async () => {
  const { runner, run } = fakeRunner();
  await appDown(repository, runner, name);
  expect(run.mock.calls).toEqual([
    [
      "helm",
      [
        "uninstall",
        name,
        `--namespace=${name}`,
        "--kube-context",
        context,
        "--ignore-not-found",
        "--wait",
        "--timeout=10m",
      ],
      { capture: false },
    ],
  ]);
});

test("down reports the data that stays, since the resources release keeps its claims", async () => {
  vi.mocked(retainedResources).mockResolvedValue([
    "postgresqlinstance.platform.kore.dev/reference-db",
  ]);
  const { runner } = fakeRunner();
  await expect(appDown(repository, runner, name)).resolves.toEqual({
    retained: ["postgresqlinstance.platform.kore.dev/reference-db"],
    warnings: [],
  });
  expect(retainedResources).toHaveBeenCalledWith(repository, runner, name);
});

test("down warns instead of failing when the retained-data read fails after the uninstall succeeded", async () => {
  vi.mocked(retainedResources).mockRejectedValue(
    new Error("Unable to connect to the server"),
  );
  const { runner, run } = fakeRunner();
  const report = await appDown(repository, runner, name);
  expect(report.retained).toEqual([]);
  expect(report.warnings).toEqual([
    `could not list retained data in namespace ${name}: Unable to connect to the server. The workload was uninstalled; check retained claims with kubectl before destroying anything.`,
  ]);
  expect(run).toHaveBeenCalledTimes(1);
});

test("down fails and reads no retained data when the uninstall itself fails", async () => {
  const { runner, run } = fakeRunner();
  run.mockRejectedValueOnce(new Error("helm uninstall timed out"));
  await expect(appDown(repository, runner, name)).rejects.toThrow(
    "helm uninstall timed out",
  );
  expect(retainedResources).not.toHaveBeenCalled();
});

test("down refuses on the wrong cluster before it uninstalls anything", async () => {
  vi.mocked(assertExpectedCluster).mockRejectedValue(
    new Error("wrong context"),
  );
  const { runner, run } = fakeRunner();
  await expect(appDown(repository, runner, name)).rejects.toThrow(
    "wrong context",
  );
  expect(run).not.toHaveBeenCalled();
});
