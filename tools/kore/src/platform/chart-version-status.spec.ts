// Docs: docs/decisions/0150-platform-releases-reach-vps-by-a-recorded-rollout-and-roll-back-by-revert.md
import { beforeEach, expect, test, vi } from "vitest";
import {
  enabledComponents,
  releaseOwner,
  type Component,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import {
  chartVersionRowPrefix,
  chartVersionStatus,
} from "./chart-version-status.js";
import { errorMessage } from "./probe.js";

vi.mock("../config/index.js");
vi.mock("./probe.js");

const repository = {
  environment: { name: "vps", kubeContext: "kore-vps" },
} as unknown as Repository;

const component = (
  name: string,
  namespace: string,
  kind: "helm" | "manifest" = "helm",
) => ({ name, namespace, kind }) as unknown as Component;

const metadata = (chart: string, version: string) => ({
  stdout: JSON.stringify({ name: "x", chart, version, appVersion: "9" }),
});

const run = vi.fn<Runner["run"]>();
const runner = { run } as unknown as Runner;

beforeEach(() => {
  run.mockReset();
  vi.mocked(enabledComponents).mockReturnValue([]);
  vi.mocked(releaseOwner).mockReturnValue("kore");
  vi.mocked(errorMessage).mockImplementation((error) =>
    error instanceof Error ? error.message : String(error),
  );
});

test("each installed Helm release gets a row naming its chart and version, read with helm get metadata", async () => {
  vi.mocked(enabledComponents).mockReturnValue([
    component("cert-manager", "cert-manager"),
  ]);
  run.mockResolvedValue(
    metadata("cert-manager", "v1.19.1") as Awaited<ReturnType<Runner["run"]>>,
  );

  const rows = await chartVersionStatus(repository, runner);

  expect(rows).toEqual([
    {
      name: `${chartVersionRowPrefix}cert-manager`,
      namespace: "cert-manager",
      status: "ready",
      detail: "cert-manager v1.19.1",
      chart: { name: "cert-manager", version: "v1.19.1" },
    },
  ]);
  expect(run).toHaveBeenCalledExactlyOnceWith(
    "helm",
    [
      "get",
      "metadata",
      "cert-manager",
      "--namespace",
      "cert-manager",
      "--kube-context",
      "kore-vps",
      "--output",
      "json",
    ],
    { capture: true },
  );
});

test("a manifest component and an Argo CD owned release have no Helm release, so they get no row and no helm call", async () => {
  const delivered = component("kore-config-delivery", "argocd");
  vi.mocked(enabledComponents).mockReturnValue([
    component("gateway-api", "gateway", "manifest"),
    delivered,
  ]);
  vi.mocked(releaseOwner).mockImplementation((_environment, candidate) =>
    candidate === delivered ? "argocd" : "kore",
  );

  expect(await chartVersionStatus(repository, runner)).toEqual([]);

  expect(run).not.toHaveBeenCalled();
});

test("a release helm cannot read is a missing row naming the cause, and the other releases are still read", async () => {
  vi.mocked(enabledComponents).mockReturnValue([
    component("broken", "ns-a"),
    component("fine", "ns-b"),
  ]);
  run
    .mockRejectedValueOnce(new Error("release: not found"))
    .mockResolvedValueOnce(
      metadata("fine", "1.2.3") as Awaited<ReturnType<Runner["run"]>>,
    );

  const rows = await chartVersionStatus(repository, runner);

  expect(rows).toEqual([
    {
      name: `${chartVersionRowPrefix}broken`,
      namespace: "ns-a",
      status: "missing",
      detail: "chart version could not be read: release: not found",
    },
    {
      name: `${chartVersionRowPrefix}fine`,
      namespace: "ns-b",
      status: "ready",
      detail: "fine 1.2.3",
      chart: { name: "fine", version: "1.2.3" },
    },
  ]);
});

test("helm output that names no chart or version is a missing row, never a row of blanks", async () => {
  vi.mocked(enabledComponents).mockReturnValue([component("odd", "ns")]);
  run.mockResolvedValue({ stdout: "{}" } as Awaited<ReturnType<Runner["run"]>>);

  const [row] = await chartVersionStatus(repository, runner);

  expect(row).toMatchObject({ status: "missing" });
  expect(row).not.toHaveProperty("chart");
});
