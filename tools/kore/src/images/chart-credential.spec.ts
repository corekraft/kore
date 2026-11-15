// Docs: docs/decisions/0034-registry-authentication-and-authorization.md (stream-only Secrets)
import { beforeEach, expect, test, vi } from "vitest";
import { chartRepositoryUrls } from "../config/index.js";
import {
  koreManagesRegistryAuth,
  loadRegistryCredential,
  registryAddress,
  withSecretsRedacted,
} from "./registry-auth.js";
import { applyChartCredential } from "./chart-credential.js";
import { fakeRepository, fakeRunner } from "./images.fixtures.js";

vi.mock("../config/index.js");
vi.mock("./registry-auth.js");

const delivery = {
  charts: {},
  namespaces: {},
  gatewayClassName: "istio",
};
const repository = {
  ...fakeRepository(),
  chartDelivery: delivery,
};

beforeEach(() => {
  vi.mocked(withSecretsRedacted).mockImplementation(
    async (_secrets, operation) => await operation(),
  );
  vi.mocked(chartRepositoryUrls).mockReturnValue(["10.96.0.50:5000/charts"]);
  vi.mocked(koreManagesRegistryAuth).mockReturnValue(true);
  vi.mocked(registryAddress).mockReturnValue("10.96.0.50:5000");
  vi.mocked(loadRegistryCredential).mockResolvedValue({
    username: "kore-read",
    password: "s3cret",
  });
});

test("the read credential reaches Argo CD only through kubectl's stdin, in the configured context", async () => {
  const { runner, calls } = fakeRunner();
  await expect(applyChartCredential(repository, runner)).resolves.toBe(true);
  expect(loadRegistryCredential).toHaveBeenCalledWith(
    repository,
    runner,
    "read",
  );
  const { command, args, options } = calls[0]!;
  expect([command, args]).toEqual([
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "apply",
      "--server-side",
      "--field-manager=kore-chart-credential",
      "--force-conflicts",
      "--filename=-",
    ],
  ]);
  expect(JSON.parse(options!.input!)).toEqual({
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "kore-platform-charts-0",
      namespace: "argocd",
      labels: { "argocd.argoproj.io/secret-type": "repository" },
    },
    type: "Opaque",
    stringData: {
      type: "helm",
      name: "kore-platform-charts-0",
      enableOCI: "true",
      url: "10.96.0.50:5000/charts",
      username: "kore-read",
      password: "s3cret",
    },
  });
  expect(JSON.stringify(args)).not.toContain("s3cret");
});

test("a chart host that is not the platform registry gets no credential, so the read identity never leaves it", async () => {
  vi.mocked(chartRepositoryUrls).mockReturnValue([
    "ghcr.io/corekraft/kore/charts",
  ]);
  const { runner, calls } = fakeRunner();
  await expect(applyChartCredential(repository, runner)).resolves.toBe(false);
  expect(loadRegistryCredential).not.toHaveBeenCalled();
  expect(calls).toEqual([]);
});

test("a registry the provider owns gets no credential from kore", async () => {
  vi.mocked(koreManagesRegistryAuth).mockReturnValue(false);
  const { runner, calls } = fakeRunner();
  await expect(applyChartCredential(repository, runner)).resolves.toBe(false);
  expect(calls).toEqual([]);
});

test("the apply runs inside secret redaction for the password, so a failure cannot leak it", async () => {
  vi.mocked(withSecretsRedacted).mockImplementation(
    async (_secrets, operation) => await operation(),
  );
  const { runner } = fakeRunner();
  await applyChartCredential(repository, runner);
  expect(vi.mocked(withSecretsRedacted).mock.calls[0]![0]).toEqual(["s3cret"]);
});

test("without composed delivery values there is nothing to credential", async () => {
  const { runner, calls } = fakeRunner();
  await expect(applyChartCredential(fakeRepository(), runner)).resolves.toBe(
    false,
  );
  expect(calls).toEqual([]);
});
