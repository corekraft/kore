// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (the handover values)
import { readFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import {
  absolute,
  chartDeliveryValues,
  componentValues,
  helmInstalledComponents,
} from "../config/index.js";
import { isReleaseAutomationSigner } from "../images/index.js";
import { composeChartDelivery } from "./chart-delivery.js";
import { fakeComponent, fakeRepository } from "./platform-support.js";

vi.mock("node:fs/promises");
vi.mock("../config/index.js");
vi.mock("../images/index.js");

const repository = { ...fakeRepository(), catalog: { components: [] } };
const values = {
  charts: {},
  namespaces: {},
  gatewayClassName: "istio",
  platformDomain: "kore.internal",
  platformHostname: "*.platform.kore.internal",
};
const delivered = {
  charts: {
    "kore-platform-config": {
      chart: "reg/charts/kore-platform-config",
      digest: "sha256:1",
    },
    "opa-authorizer": {
      chart: "reg/charts/opa-authorizer",
      digest: "sha256:2",
    },
  },
  namespaces: {},
  gatewayClassName: "istio",
  platformDomain: "kore.internal",
  platformHostname: "*.platform.kore.internal",
};
const lockText = '{"version":1,"entries":{}}';
/** readFile answers the lock with its text and each values file from `files`, failing any other path. */
const readsFiles = (files: Record<string, string | Error>) =>
  vi.mocked(readFile).mockImplementation(async (path) => {
    const name = typeof path === "string" ? path : "";
    if (name === "lock.json") {
      return lockText;
    }
    const file = files[name];
    if (file === undefined || file instanceof Error) {
      throw file ?? new Error(`unexpected read of ${name}`);
    }
    return file;
  });
const withComponents = (
  features: Record<string, boolean> | undefined,
  ...components: ReturnType<typeof fakeComponent>[]
) => ({
  ...fakeRepository(features === undefined ? {} : { features }),
  catalog: { components },
});

beforeEach(() => {
  vi.mocked(helmInstalledComponents).mockReturnValue([
    fakeComponent({ name: "kore-config-delivery" }),
  ]);
  vi.mocked(readFile).mockResolvedValue('{"version":1,"entries":{}}');
  vi.mocked(chartDeliveryValues).mockReturnValue(values);
  vi.mocked(componentValues).mockReturnValue([]);
  vi.mocked(absolute).mockImplementation((_, path) => `/repo/${path}`);
});

test("the repository gains the values composed from the lock file and the catalog", async () => {
  await expect(composeChartDelivery(repository, "lock.json")).resolves.toEqual({
    ...repository,
    chartDelivery: { ...values, releaseValues: {} },
  });
  expect(readFile).toHaveBeenCalledWith("lock.json", "utf8");
  expect(chartDeliveryValues).toHaveBeenCalledWith(repository, {
    version: 1,
    entries: {},
  });
});

test("with the flag off the repository is untouched and no file is read, even if a path is given", async () => {
  vi.mocked(helmInstalledComponents).mockReturnValue([fakeComponent()]);
  await expect(composeChartDelivery(repository, "lock.json")).resolves.toBe(
    repository,
  );
  expect(readFile).not.toHaveBeenCalled();
});

test("a missing lock flag names the flag and the fix", async () => {
  await expect(composeChartDelivery(repository, undefined)).rejects.toThrow(
    "--platform-chart-lock <file> is required while platform-argocd-delivery is on in local; pass the platform-charts.lock.json attached to the release",
  );
});

test("an unreadable or non-JSON lock names the path and the fix", async () => {
  vi.mocked(readFile).mockResolvedValue("not json");
  await expect(composeChartDelivery(repository, "lock.json")).rejects.toThrow(
    /^--platform-chart-lock lock\.json must be the platform-charts\.lock\.json of a release: /,
  );
  expect(chartDeliveryValues).not.toHaveBeenCalled();
});

test("a lock that fails validation stops before any cluster call, with the errors", async () => {
  vi.mocked(chartDeliveryValues).mockImplementation(() => {
    throw new Error("platform chart lock: no entry for release opa-authorizer");
  });
  await expect(composeChartDelivery(repository, "lock.json")).rejects.toThrow(
    "platform chart lock: no entry for release opa-authorizer",
  );
});

test("each delivered release is handed the text of its values files in the order the Helm path takes them, read from the repository and never parsed by kore", async () => {
  const repo = withComponents(
    undefined,
    fakeComponent({ name: "kore-platform-config", kind: "manifest" }),
    fakeComponent({ name: "opa-authorizer", kind: "manifest" }),
  );
  vi.mocked(chartDeliveryValues).mockReturnValue(delivered);
  vi.mocked(componentValues).mockImplementation((_, component) =>
    component.name === "kore-platform-config"
      ? ["common.yaml", "local.yaml"]
      : [],
  );
  readsFiles({
    "/repo/common.yaml": "gateway:\n  port: 443\n",
    "/repo/local.yaml": "gateway:\n  port: 8443\n",
  });
  const composed = await composeChartDelivery(repo, "lock.json");
  expect(composed.chartDelivery?.releaseValues).toEqual({
    "kore-platform-config": [
      "gateway:\n  port: 443\n",
      "gateway:\n  port: 8443\n",
    ],
  });
});

test("a delivered chart release also takes the environment's feature flags as the Helm path does, last, so a values file never shadows a flag", async () => {
  const repo = withComponents(
    { "ingress-agentgateway": true, "agentgateway-mesh-enrollment": false },
    fakeComponent({ name: "kore-platform-config", kind: "local-chart" }),
    fakeComponent({ name: "opa-authorizer", kind: "manifest" }),
  );
  vi.mocked(chartDeliveryValues).mockReturnValue(delivered);
  vi.mocked(componentValues).mockReturnValue(["local.yaml"]);
  readsFiles({ "/repo/local.yaml": "gateway: {}\n" });
  const composed = await composeChartDelivery(repo, "lock.json");
  expect(composed.chartDelivery?.releaseValues).toEqual({
    "kore-platform-config": [
      "gateway: {}\n",
      '{"features":{"ingress-agentgateway":true,"agentgateway-mesh-enrollment":false}}',
    ],
    "opa-authorizer": ["gateway: {}\n"],
  });
});

test("a release with no values files and no flags is left out, so its Application takes the chart's defaults", async () => {
  const repo = withComponents(
    undefined,
    fakeComponent({ name: "kore-platform-config", kind: "local-chart" }),
    fakeComponent({ name: "opa-authorizer", kind: "manifest" }),
  );
  vi.mocked(chartDeliveryValues).mockReturnValue(delivered);
  const composed = await composeChartDelivery(repo, "lock.json");
  expect(composed.chartDelivery?.releaseValues).toEqual({});
  expect(readFile).not.toHaveBeenCalledWith(
    expect.stringMatching(/\.yaml$/),
    "utf8",
  );
});

test("an unreadable values file names the release and the path, before any cluster call", async () => {
  const repo = withComponents(
    undefined,
    fakeComponent({ name: "kore-platform-config", kind: "manifest" }),
    fakeComponent({ name: "opa-authorizer", kind: "manifest" }),
  );
  vi.mocked(chartDeliveryValues).mockReturnValue(delivered);
  vi.mocked(componentValues).mockReturnValue(["gone.yaml"]);
  readsFiles({ "/repo/gone.yaml": new Error("ENOENT") });
  await expect(composeChartDelivery(repo, "lock.json")).rejects.toThrow(
    /^kore-platform-config values file \/repo\/gone\.yaml is unreadable: /,
  );
});

const releaseSigner =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.10.1";
const mainSigner =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/heads/main";
const vps = {
  ...fakeRepository({ name: "vps", provider: "managed" }),
  catalog: { components: [] },
};
/** A chart lock as the charts jobs write it: its authorized signers declare whose identity signed it. */
const signedLock = (...signers: string[]) =>
  JSON.stringify({ version: 1, authorizedSigners: signers, entries: {} });

test("a managed environment refuses a main chart lock before any cluster call, and names the release lock to use", async () => {
  vi.mocked(isReleaseAutomationSigner).mockImplementation(
    (signer) => signer === releaseSigner,
  );
  vi.mocked(readFile).mockResolvedValue(signedLock(mainSigner));
  await expect(composeChartDelivery(vps, "main.json")).rejects.toThrow(
    /^--platform-chart-lock main\.json is not the release chart lock: it is signed by .*refs\/heads\/main, and vps takes only a lock signed by release automation at a version tag .*[Pp]ass the platform-charts\.lock\.json attached to the release/,
  );
  expect(chartDeliveryValues).not.toHaveBeenCalled();
});

test("a managed environment refuses a main chart lock even while platform-argocd-delivery is off, since the lock is handed in for the run", async () => {
  vi.mocked(isReleaseAutomationSigner).mockImplementation(
    (signer) => signer === releaseSigner,
  );
  vi.mocked(helmInstalledComponents).mockReturnValue([]);
  vi.mocked(readFile).mockResolvedValue(signedLock(mainSigner));
  await expect(composeChartDelivery(vps, "main.json")).rejects.toThrow(
    "is not the release chart lock",
  );
  expect(chartDeliveryValues).not.toHaveBeenCalled();
});

test("a managed environment refuses a lock signed by a developer key or naming no signer, since only release automation is known to sign a release lock", async () => {
  vi.mocked(isReleaseAutomationSigner).mockImplementation(
    (signer) => signer === releaseSigner,
  );
  vi.mocked(readFile).mockResolvedValue(signedLock("local-kore-key"));
  await expect(composeChartDelivery(vps, "local.json")).rejects.toThrow(
    "is not the release chart lock",
  );
  vi.mocked(readFile).mockResolvedValue(lockText);
  await expect(composeChartDelivery(vps, "bare.json")).rejects.toThrow(
    "is not the release chart lock",
  );
  expect(chartDeliveryValues).not.toHaveBeenCalled();
});

test("a managed environment takes the release chart lock as before", async () => {
  vi.mocked(isReleaseAutomationSigner).mockImplementation(
    (signer) => signer === releaseSigner,
  );
  vi.mocked(readFile).mockResolvedValue(signedLock(releaseSigner));
  vi.mocked(chartDeliveryValues).mockReturnValue(values);
  await expect(composeChartDelivery(vps, "release.json")).resolves.toEqual({
    ...vps,
    chartDelivery: { ...values, releaseValues: {} },
  });
  expect(chartDeliveryValues).toHaveBeenCalledWith(vps, {
    version: 1,
    authorizedSigners: [releaseSigner],
    entries: {},
  });
});

test("local still accepts a main chart lock for a local proof", async () => {
  vi.mocked(readFile).mockResolvedValue(signedLock(mainSigner));
  vi.mocked(chartDeliveryValues).mockReturnValue(values);
  await expect(composeChartDelivery(repository, "main.json")).resolves.toEqual({
    ...repository,
    chartDelivery: { ...values, releaseValues: {} },
  });
});
