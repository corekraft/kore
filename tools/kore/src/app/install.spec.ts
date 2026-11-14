// Docs: docs/decisions/0025-application-namespace-ambient-enrollment.md
import { access } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import {
  koreManagesRegistryAuth,
  loadRegistryCredential,
  registryPullSecret,
} from "../images/index.js";
import {
  argsFingerprint,
  releaseMatchesFingerprint,
} from "../platform/index.js";
import { errno, fakeImage, fakeRepository, fakeRunner } from "./app-support.js";
import { installDefaults } from "./install-support.js";
import {
  activateNamespace,
  bindCrossplaneSecrets,
  enrollNamespace,
  installResources,
  installWorkload,
  resolveCharts,
} from "./install.js";
import { releaseArgs } from "./release.js";

vi.mock("node:fs/promises");
vi.mock("node:path");
vi.mock("../images/index.js");
vi.mock("../platform/index.js");
vi.mock("./release.js");

const name = "reference";
const context = "k3d-kore-local";
const label = "policy.sigstore.dev/include";
const generation = "g-abc";
const repository = fakeRepository();
beforeEach(installDefaults);
const charts = {
  resources: "/repo/apps/reference/charts/resources",
  workload: "/repo/apps/reference/charts/workload",
};

test("a chart is resolved from the application's own directory only after its Chart.yaml exists", async () => {
  await expect(resolveCharts(repository, name)).resolves.toEqual({
    resources: "/repo/apps/reference/charts/resources",
    workload: "/repo/apps/reference/charts/workload",
  });
  expect(access).toHaveBeenCalledWith(
    "/repo/apps/reference/charts/resources/Chart.yaml",
  );
});

test("an application name that is not a lowercase DNS label is refused before any chart path is resolved", async () => {
  await expect(resolveCharts(repository, "Ref_Name")).rejects.toThrow(
    "invalid application name: Ref_Name",
  );
  expect(access).not.toHaveBeenCalled();
});

test("a chart with no Chart.yaml is refused, so nothing is installed from an empty directory", async () => {
  vi.mocked(access).mockRejectedValue(errno("ENOENT"));
  await expect(resolveCharts(repository, name)).rejects.toThrow("ENOENT");
});

test("enrollment applies the namespace with the ambient mesh and the Sigstore admission label, in the configured context", async () => {
  const { run, runner } = fakeRunner(() => "true");
  await enrollNamespace(repository, runner, name);
  expect(run.mock.calls[0]).toEqual([
    "kubectl",
    [
      "--context",
      context,
      "apply",
      "--server-side",
      "--field-manager=kore-app",
      "--filename",
      "-",
    ],
    {
      capture: true,
      input: `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: reference\n  labels:\n    istio.io/dataplane-mode: ambient\n    ${label}: "true"\n`,
    },
  ]);
});

test("enrollment reads the admission label back before returning, so an unlabelled namespace is never reported as enrolled", async () => {
  const { run, runner } = fakeRunner(() => "true");
  await enrollNamespace(repository, runner, name);
  expect(run.mock.calls[1]).toEqual([
    "kubectl",
    [
      "--context",
      context,
      "get",
      "namespace",
      name,
      "--output",
      "jsonpath={.metadata.labels.policy\\.sigstore\\.dev/include}",
    ],
    { capture: true },
  ]);
});

test("a namespace whose admission label did not stick refuses the release with the fix", async () => {
  const { runner } = fakeRunner(() => "");
  await expect(enrollNamespace(repository, runner, name)).rejects.toThrow(
    /reference.*not enrolled in image admission.*Rerun kore app up/s,
  );
});

test("a refused enrollment never distributes the registry credential", async () => {
  const { runner, run } = fakeRunner(() => "");
  await expect(enrollNamespace(repository, runner, name)).rejects.toThrow();
  expect(loadRegistryCredential).not.toHaveBeenCalled();
  expect(run).toHaveBeenCalledTimes(2);
});

test("enrollment gives the namespace only the read-only registry identity, as its signature pull Secret", async () => {
  const { runner, run } = fakeRunner(() => "true");
  await enrollNamespace(repository, runner, name);
  expect(loadRegistryCredential).toHaveBeenCalledWith(
    repository,
    runner,
    "read",
  );
  expect(registryPullSecret).toHaveBeenCalledWith(
    "registry.kore.local:30500",
    { username: "kore-read" },
    name,
  );
  expect(run.mock.calls[2]?.[2]?.input).toBe(
    JSON.stringify({
      apiVersion: "v1",
      kind: "List",
      items: [{ metadata: { name: "kore-registry-pull" } }],
    }),
  );
});

test("an external registry keeps the provider's credentials, so no in-cluster pull Secret is distributed", async () => {
  vi.mocked(koreManagesRegistryAuth).mockReturnValue(false);
  const { runner, run } = fakeRunner(() => "true");
  await enrollNamespace(repository, runner, name);
  expect(loadRegistryCredential).not.toHaveBeenCalled();
  expect(run).toHaveBeenCalledTimes(2);
});

test("activation stamps the platform generation on the namespace with a forced server-side apply in the configured context", async () => {
  const { run, runner } = fakeRunner(() => generation);
  await activateNamespace(repository, runner, name, generation);
  expect(run.mock.calls[0]).toEqual([
    "kubectl",
    [
      "--context",
      context,
      "apply",
      "--server-side",
      "--field-manager=kore-activation",
      "--force-conflicts",
      "--filename",
      "-",
    ],
    {
      capture: true,
      input: `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: reference\n  labels:\n    platform.kore.dev/activation-generation: ${generation}\n`,
    },
  ]);
});

test("activation reads the label back and refuses the release when the gate did not admit that generation", async () => {
  const { runner } = fakeRunner(() => "g-stale");
  await expect(
    activateNamespace(repository, runner, name, generation),
  ).rejects.toThrow(
    /reference.*not activated.*platform\.kore\.dev\/activation-generation=g-abc.*Rerun kore app up/s,
  );
});

test("Crossplane's Secret role is bound in the application namespace through a RoleBinding to its ServiceAccount", async () => {
  const { run, runner } = fakeRunner();
  await bindCrossplaneSecrets(repository, runner, name);
  expect(run.mock.calls[0]?.[1]).toEqual(
    expect.arrayContaining(["--field-manager=kore-app", "--force-conflicts"]),
  );
  expect(JSON.parse(run.mock.calls[0]?.[2]?.input ?? "{}")).toEqual({
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "RoleBinding",
    metadata: { name: "crossplane-postgresql-secrets", namespace: name },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "ClusterRole",
      name: "crossplane-postgresql-secrets",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: "crossplane",
        namespace: "crossplane-system",
      },
    ],
  });
});

test("Crossplane's Secret role is never bound in kore-system, kube-system or a component's platform namespace", async () => {
  const withComponent = {
    ...repository,
    catalog: { components: [{ namespace: "crossplane-system" }] },
  } as unknown as typeof repository;
  for (const namespace of ["kore-system", "kube-system", "crossplane-system"]) {
    const { run, runner } = fakeRunner();
    await expect(
      bindCrossplaneSecrets(withComponent, runner, namespace),
    ).rejects.toThrow(
      `refusing to grant Crossplane Secret access in platform namespace ${namespace}`,
    );
    expect(run).not.toHaveBeenCalled();
  }
});

test("a release is upgraded when its desired state differs from what Helm recorded, recording the fingerprint as its description", async () => {
  const { run, runner } = fakeRunner();
  await expect(
    installResources(repository, runner, name, charts),
  ).resolves.toBeUndefined();
  expect(releaseMatchesFingerprint).toHaveBeenCalledWith(
    repository,
    runner,
    { name: `${name}-resources`, namespace: name },
    "fp-1",
  );
  expect(run.mock.calls).toEqual([
    [
      "helm",
      [
        "upgrade",
        `${name}-resources`,
        charts.resources,
        "--description",
        "fp-1",
      ],
      { capture: false },
    ],
  ]);
});

test("a release already deployed from the same desired state is not upgraded at all", async () => {
  vi.mocked(releaseMatchesFingerprint).mockResolvedValue(true);
  const { run, runner } = fakeRunner();
  await installResources(repository, runner, name, charts);
  expect(run).not.toHaveBeenCalled();
});

test("the fingerprint is taken over the full Helm arguments with the chart as a repository-relative path", async () => {
  const { runner } = fakeRunner();
  await installResources(repository, runner, name, charts);
  expect(argsFingerprint).toHaveBeenCalledWith(
    ["upgrade", `${name}-resources`, "apps/reference/charts/resources"],
    charts.resources,
  );
});

test("the workload release is installed under the application's own name with its image, and with a secret version only when there is one", async () => {
  const image = fakeImage();
  const { runner } = fakeRunner();
  await installWorkload(repository, runner, name, charts, {
    image,
    secretVersion: "v1",
  });
  await installWorkload(repository, runner, name, charts, { image });
  expect(releaseArgs).toHaveBeenNthCalledWith(
    1,
    repository,
    name,
    name,
    charts.workload,
    { image, secretVersion: "v1" },
  );
  expect(releaseArgs).toHaveBeenNthCalledWith(
    2,
    repository,
    name,
    name,
    charts.workload,
    { image },
  );
});

test("a new image digest upgrades only the workload release, leaving the resources release untouched", async () => {
  vi.mocked(releaseMatchesFingerprint).mockImplementation(
    async (_repo, _run, target) => target.name === `${name}-resources`,
  );
  const { run, runner } = fakeRunner();
  await installResources(repository, runner, name, charts);
  await installWorkload(repository, runner, name, charts, {
    image: fakeImage(),
  });
  expect(run.mock.calls.map((call) => call[1][1])).toEqual([name]);
});
