import { beforeEach, expect, test, vi } from "vitest";
import {
  componentValues,
  expandVersions,
  featureHelmArgs,
  gatewayClassName,
  noMatchPolicy,
  registryHelmArgs,
} from "../config/index.js";
import {
  envOption,
  helmEnv,
  helmTemplateArgs,
  helmUpgradeArgs,
  manifestSource,
  patchFailure,
  withAbsoluteChart,
} from "./helm.js";
import { configAnswers } from "./helm-support.js";
import { applyProbePatches } from "./patches.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";

vi.mock("../config/index.js", () => ({
  absolute: vi.fn(),
  componentValues: vi.fn(),
  componentVersion: vi.fn(),
  expandVersions: vi.fn(),
  featureHelmArgs: vi.fn(),
  gatewayClassName: vi.fn(),
  noMatchPolicy: vi.fn(),
  registryConsumers: ["oci-registry", "kore-image-policy"],
  registryHelmArgs: vi.fn(),
}));
vi.mock("./patches.js");

const repository = fakeRepository();
const patch = {
  target: { kind: "Deployment", name: "reference", container: "manager" },
  reason: "chart has no timeout value",
  probes: { livenessProbe: { timeoutSeconds: 5 } },
};
const upgradeHead = [
  "upgrade",
  "--install",
  "reference",
  "oci://registry.example/charts",
  "--namespace",
  "reference",
  "--create-namespace",
  "--kube-context",
  "k3d-kore-local",
];

beforeEach(configAnswers);

test("a component without patches gets no Helm environment, so the user's own plugins stay in use", () => {
  expect(helmEnv(repository, fakeComponent())).toBeUndefined();
  expect(envOption(undefined)).toEqual({});
});

test("a component with patches points Helm at the repository's plugin directory", () => {
  const env = helmEnv(repository, fakeComponent({ patches: [patch] }));
  expect(env).toEqual(
    expect.objectContaining({ HELM_PLUGINS: "/repo/infra/helm-plugins" }),
  );
  expect(envOption(env)).toEqual({ env });
});

test("the upgrade of a plain OCI component waits, rolls back on failure and pins its version", () => {
  expect(helmUpgradeArgs(repository, fakeComponent())).toEqual([
    ...upgradeHead,
    "--wait",
    "--timeout",
    "10m",
    "--rollback-on-failure",
    "--version",
    "1.2.3",
  ]);
});

test("a component that opts out of the wait waits for hooks only and never rolls back", () => {
  const args = helmUpgradeArgs(
    repository,
    fakeComponent({ helm: { wait: false, reason: "claim binds later" } }),
  );
  expect(args).toContain("--wait=hookOnly");
  expect(args).not.toContain("--wait");
  expect(args).not.toContain("--rollback-on-failure");
});

test("force-conflicts is passed only for a release that takes over co-owned fields", () => {
  const takeover = fakeComponent({
    helm: { forceConflicts: true, reason: "controller co-owns fields" },
  });
  expect(helmUpgradeArgs(repository, takeover)).toContain("--force-conflicts");
  expect(helmUpgradeArgs(repository, fakeComponent())).not.toContain(
    "--force-conflicts",
  );
});

test("a non-OCI Helm repository is passed with --repo and the chart name is the target", () => {
  const args = helmUpgradeArgs(
    repository,
    fakeComponent({
      repository: "https://charts.example",
      chart: "cnpg",
    }),
  );
  expect(args.slice(2, 4)).toEqual(["reference", "cnpg"]);
  expect(args.slice(-4)).toEqual([
    "--repo",
    "https://charts.example",
    "--version",
    "1.2.3",
  ]);
});

test("a local chart is installed from its path, with the feature flags and its values made absolute", () => {
  vi.mocked(componentValues).mockReturnValue(["infra/values/a.yaml"]);
  vi.mocked(featureHelmArgs).mockReturnValue(["--set", "features.gate=true"]);
  const { repository: _repository, ...local } = fakeComponent({
    kind: "local-chart",
    chart: "charts/reference",
  });
  const args = helmUpgradeArgs(repository, local);
  expect(args.slice(3, 4)).toEqual(["charts/reference"]);
  expect(args.slice(-4)).toEqual([
    "--values",
    "/repo/infra/values/a.yaml",
    "--set",
    "features.gate=true",
  ]);
});

test("a registry consumer receives the registry's Helm arguments, and no other component does", () => {
  const consumer = helmUpgradeArgs(
    repository,
    fakeComponent({ name: "oci-registry" }),
  );
  expect(consumer.slice(-2)).toEqual(["--set-string", "registry=oci-registry"]);
  expect(registryHelmArgs).toHaveBeenCalledWith(
    repository.environment,
    "oci-registry",
  );
  const other = helmUpgradeArgs(repository, fakeComponent());
  expect(other).not.toContain("--set-string");
});

test("the platform config release is told the gateway class from its environment", () => {
  const args = helmUpgradeArgs(
    repository,
    fakeComponent({ name: "kore-platform-config" }),
  );
  expect(args.slice(-2)).toEqual([
    "--set-string",
    "gateway.className=kore-gateway",
  ]);
  expect(gatewayClassName).toHaveBeenCalledWith(repository.environment);
});

test("the platform Backstage release is told the gateway class from its environment, so its route has a Gateway to bind", () => {
  const args = helmUpgradeArgs(
    repository,
    fakeComponent({ name: "kore-platform-backstage" }),
  );
  expect(args.slice(-2)).toEqual([
    "--set-string",
    "gatewayClassName=kore-gateway",
  ]);
  const other = helmUpgradeArgs(repository, fakeComponent());
  expect(other).not.toContain("gatewayClassName=kore-gateway");
});

test("policy-controller is given its no-match policy, and no other component is", () => {
  vi.mocked(noMatchPolicy).mockReturnValue("deny");
  const args = helmUpgradeArgs(
    repository,
    fakeComponent({ name: "policy-controller" }),
  );
  expect(args.slice(-2)).toEqual([
    "--set-string",
    "webhook.configData.no-match-policy=deny",
  ]);
  expect(helmUpgradeArgs(repository, fakeComponent())).not.toContain(
    "webhook.configData.no-match-policy=deny",
  );
});

test("a component with patches is upgraded through the kore-patch post-renderer with its patches as arguments", () => {
  const args = helmUpgradeArgs(repository, fakeComponent({ patches: [patch] }));
  expect(args.slice(-4)).toEqual([
    "--post-renderer",
    "kore-patch",
    "--post-renderer-args",
    JSON.stringify([patch]),
  ]);
});

test("the template of a component names the release and includes its CRDs, with the same selection", () => {
  expect(helmTemplateArgs(repository, fakeComponent())).toEqual([
    "template",
    "reference",
    "oci://registry.example/charts",
    "--namespace",
    "reference",
    "--include-crds",
    "--version",
    "1.2.3",
  ]);
});

test("only the local chart's path is made absolute, wherever it appears in the arguments", () => {
  const chart = fakeComponent({ kind: "local-chart", chart: "charts/x" });
  expect(
    withAbsoluteChart(repository, chart, ["upgrade", "charts/x", "--version"]),
  ).toEqual(["upgrade", "/repo/charts/x", "--version"]);
  expect(
    withAbsoluteChart(repository, fakeComponent(), ["upgrade", "reference"]),
  ).toEqual(["upgrade", "reference"]);
});

test("a manifest source that is a URL is used as it is, and a path is made absolute", () => {
  const url = fakeComponent({
    kind: "manifest",
    source: "https://example.com/crds.yaml",
  });
  expect(manifestSource(repository, url)).toBe("https://example.com/crds.yaml");
  const local = fakeComponent({ kind: "manifest", source: "manifests/crds" });
  expect(manifestSource(repository, local)).toBe("/repo/manifests/crds");
});

test("a manifest source overridden by the environment is read from there", () => {
  const overridden = fakeRepository({
    componentSources: { crds: "manifests/override" },
  });
  const component = fakeComponent({
    name: "crds",
    kind: "manifest",
    source: "manifests/default",
  });
  expect(manifestSource(overridden, component)).toBe(
    "/repo/manifests/override",
  );
  expect(expandVersions).toHaveBeenCalledWith(overridden, "manifests/override");
});

test("a component without patches needs no post-render check, so Helm is not run", async () => {
  const { runner, run } = fakeRunner();
  await expect(
    patchFailure(repository, runner, fakeComponent()),
  ).resolves.toBeUndefined();
  expect(run).not.toHaveBeenCalled();
});

test("a patch failure is reported by rendering the chart without the post-renderer and applying the patches", async () => {
  const { runner, run } = fakeRunner(() => "kind: Deployment\n");
  const component = fakeComponent({ patches: [patch] });
  await expect(patchFailure(repository, runner, component)).resolves.toBe(
    undefined,
  );
  const [, args] = run.mock.calls[0]!;
  expect(args).not.toContain("--post-renderer");
  expect(applyProbePatches).toHaveBeenCalledWith("kind: Deployment\n", [patch]);
});

test("a patch target that cannot be found is the failure reported, with its own message", async () => {
  vi.mocked(applyProbePatches).mockImplementation(() => {
    throw new Error("patch target Deployment/reference is missing");
  });
  const { runner } = fakeRunner(() => "kind: Deployment\n");
  await expect(
    patchFailure(repository, runner, fakeComponent({ patches: [patch] })),
  ).resolves.toBe("patch target Deployment/reference is missing");
});

test("a patch error other than a missing target is not reported as the cause", async () => {
  vi.mocked(applyProbePatches).mockImplementation(() => {
    throw new Error("probe is written in flow style");
  });
  const { runner } = fakeRunner(() => "kind: Deployment\n");
  await expect(
    patchFailure(repository, runner, fakeComponent({ patches: [patch] })),
  ).resolves.toBeUndefined();
});

test("a chart that renders nothing, or cannot be rendered, reports no patch cause", async () => {
  const empty = fakeRunner(() => "  \n");
  await expect(
    patchFailure(repository, empty.runner, fakeComponent({ patches: [patch] })),
  ).resolves.toBeUndefined();
  expect(applyProbePatches).not.toHaveBeenCalled();
  const failing = fakeRunner();
  failing.run.mockRejectedValueOnce(new Error("helm template failed"));
  await expect(
    patchFailure(
      repository,
      failing.runner,
      fakeComponent({ patches: [patch] }),
    ),
  ).resolves.toBeUndefined();
});
