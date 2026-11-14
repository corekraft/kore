// Docs: infra/plans/14-test-tiers.md#step-2-pilots
import { beforeEach, expect, test, vi } from "vitest";
import {
  componentGatedOff,
  orderedComponents,
  type Component,
  type Repository,
} from "../config/index.js";
import { registryTrustProblem } from "../images/index.js";
import type { Runner } from "../runtime/index.js";
import { admissionGateStatus, type GateStatus } from "./admission-gate.js";
import { gatedReleaseProblem } from "./gated-release.js";
import {
  imageInventoryStatus,
  type ImageInventoryStatus,
} from "./image-inventory.js";
import {
  assertOwnedCrdsExist,
  errorMessage,
  helmReleaseStatus,
} from "./probe.js";
import { readinessFailure, retryBudget } from "./readiness.js";
import { platformStatus, registryTrustStatusName } from "./status.js";

vi.mock("../config/index.js");
vi.mock("../images/index.js");
vi.mock("./admission-gate.js");
vi.mock("./gated-release.js");
vi.mock("./image-inventory.js");
vi.mock("./probe.js");
vi.mock("./readiness.js");

const repository = { environment: { name: "local" } } as unknown as Repository;
const runner = {} as Runner;

function component(
  name: string,
  kind: "helm" | "manifest" = "helm",
  extra: Record<string, unknown> = {},
): Component {
  return {
    name,
    namespace: "kore-system",
    kind,
    ...extra,
  } as unknown as Component;
}

const inventoryRow = {
  name: "image-inventory",
  namespace: "cluster",
  status: "ready",
  detail: "inventory complete",
} as unknown as ImageInventoryStatus;

const gateRow = {
  name: "admission-gate",
  namespace: "kore-system",
  status: "ready",
  detail: "gate open",
} as unknown as GateStatus;

beforeEach(() => {
  vi.mocked(orderedComponents).mockReturnValue([]);
  vi.mocked(componentGatedOff).mockReturnValue(false);
  vi.mocked(gatedReleaseProblem).mockResolvedValue(undefined);
  vi.mocked(helmReleaseStatus).mockResolvedValue("deployed");
  vi.mocked(assertOwnedCrdsExist).mockResolvedValue(undefined);
  vi.mocked(errorMessage).mockImplementation((error) =>
    error instanceof Error ? error.message : String(error),
  );
  vi.mocked(readinessFailure).mockResolvedValue(undefined);
  vi.mocked(retryBudget).mockReturnValue({ spent: false });
  vi.mocked(registryTrustProblem).mockResolvedValue(undefined);
  vi.mocked(imageInventoryStatus).mockResolvedValue(inventoryRow);
  vi.mocked(admissionGateStatus).mockResolvedValue(gateRow);
});

test("a filtered status reports only the named components, in catalog order, and omits the platform-wide rows", async () => {
  vi.mocked(orderedComponents).mockReturnValue([
    component("gateway"),
    component("policy"),
    component("registry"),
  ]);

  const rows = await platformStatus(repository, runner, [
    "registry",
    "gateway",
  ]);

  expect(rows.map((row) => row.name)).toEqual(["gateway", "registry"]);
  expect(registryTrustProblem).not.toHaveBeenCalled();
  expect(imageInventoryStatus).not.toHaveBeenCalled();
  expect(admissionGateStatus).not.toHaveBeenCalled();
});

test("an unfiltered status appends the registry trust, image inventory and admission gate rows after the components", async () => {
  vi.mocked(orderedComponents).mockReturnValue([component("gateway")]);

  const rows = await platformStatus(repository, runner);

  expect(rows.map((row) => row.name)).toEqual([
    "gateway",
    registryTrustStatusName,
    "image-inventory",
    "admission-gate",
  ]);
  expect(rows.at(-1)).toBe(gateRow);
});

test("a gated-off component with a gated-release problem is degraded with that problem and is not probed", async () => {
  vi.mocked(orderedComponents).mockReturnValue([
    component("policy", "helm", { featureFlag: "policy" }),
  ]);
  vi.mocked(componentGatedOff).mockReturnValue(true);
  vi.mocked(gatedReleaseProblem).mockResolvedValue(
    "the policy release is still installed",
  );

  const [row] = await platformStatus(repository, runner, ["policy"]);

  expect(row).toEqual({
    name: "policy",
    namespace: "kore-system",
    status: "degraded",
    detail: "the policy release is still installed",
  });
  expect(helmReleaseStatus).not.toHaveBeenCalled();
  expect(readinessFailure).not.toHaveBeenCalled();
});

test("a gated-off component with no problem is reported gated-off with its feature flag and is not probed", async () => {
  vi.mocked(orderedComponents).mockReturnValue([
    component("policy", "helm", { featureFlag: "policy" }),
  ]);
  vi.mocked(componentGatedOff).mockReturnValue(true);

  const [row] = await platformStatus(repository, runner, ["policy"]);

  expect(row).toEqual({
    name: "policy",
    namespace: "kore-system",
    status: "gated-off",
    detail: "gated off: feature policy is off in local",
  });
  expect(readinessFailure).not.toHaveBeenCalled();
});

test("a manifest component checks its owned CRDs and not a Helm release", async () => {
  vi.mocked(orderedComponents).mockReturnValue([component("crds", "manifest")]);

  const [row] = await platformStatus(repository, runner, ["crds"]);

  expect(assertOwnedCrdsExist).toHaveBeenCalledWith(
    repository,
    runner,
    expect.objectContaining({ name: "crds", kind: "manifest" }),
  );
  expect(helmReleaseStatus).not.toHaveBeenCalled();
  expect(row?.status).toBe("ready");
});

test("a manifest component whose CRDs are missing is reported missing with the error that says so", async () => {
  vi.mocked(orderedComponents).mockReturnValue([component("crds", "manifest")]);
  vi.mocked(assertOwnedCrdsExist).mockRejectedValue(
    new Error('customresourcedefinitions "fakes.example.io" not found'),
  );

  const [row] = await platformStatus(repository, runner, ["crds"]);

  expect(row).toEqual({
    name: "crds",
    namespace: "kore-system",
    status: "missing",
    detail: 'customresourcedefinitions "fakes.example.io" not found',
  });
  expect(readinessFailure).not.toHaveBeenCalled();
});

test("a Helm release that is not deployed is degraded with its release status and is not probed", async () => {
  vi.mocked(orderedComponents).mockReturnValue([component("gateway")]);
  vi.mocked(helmReleaseStatus).mockResolvedValue("pending-install");

  const [row] = await platformStatus(repository, runner, ["gateway"]);

  expect(row).toEqual({
    name: "gateway",
    namespace: "kore-system",
    status: "degraded",
    detail: "Helm release status is pending-install",
  });
  expect(readinessFailure).not.toHaveBeenCalled();
});

test("a Helm release with no status yet is probed for readiness rather than reported", async () => {
  vi.mocked(orderedComponents).mockReturnValue([component("gateway")]);
  vi.mocked(helmReleaseStatus).mockResolvedValue(undefined);

  const [row] = await platformStatus(repository, runner, ["gateway"]);

  expect(readinessFailure).toHaveBeenCalledTimes(1);
  expect(row?.status).toBe("ready");
});

test("a failure reading the Helm release is reported missing with the error's message", async () => {
  vi.mocked(orderedComponents).mockReturnValue([component("gateway")]);
  vi.mocked(helmReleaseStatus).mockRejectedValue(
    new Error("Error: release: not found"),
  );

  const [row] = await platformStatus(repository, runner, ["gateway"]);

  expect(row).toEqual({
    name: "gateway",
    namespace: "kore-system",
    status: "missing",
    detail: "Error: release: not found",
  });
  expect(readinessFailure).not.toHaveBeenCalled();
});

test("a component whose readiness fails is degraded with the readiness detail", async () => {
  vi.mocked(orderedComponents).mockReturnValue([component("gateway")]);
  vi.mocked(readinessFailure).mockResolvedValue(
    "deployment/gateway not ready (0/1 available)",
  );

  const [row] = await platformStatus(repository, runner, ["gateway"]);

  expect(row).toEqual({
    name: "gateway",
    namespace: "kore-system",
    status: "degraded",
    detail: "deployment/gateway not ready (0/1 available)",
  });
});

test("a component that passes its readiness is ready with the installed-and-ready detail", async () => {
  vi.mocked(orderedComponents).mockReturnValue([component("gateway")]);

  const [row] = await platformStatus(repository, runner, ["gateway"]);

  expect(row).toEqual({
    name: "gateway",
    namespace: "kore-system",
    status: "ready",
    detail: "installed and ready",
  });
});

test("every component in one status run shares the same retry budget", async () => {
  const budget = { spent: false };
  vi.mocked(retryBudget).mockReturnValue(budget);
  vi.mocked(orderedComponents).mockReturnValue([
    component("gateway"),
    component("policy"),
  ]);

  await platformStatus(repository, runner);

  expect(retryBudget).toHaveBeenCalledTimes(1);
  expect(readinessFailure).toHaveBeenCalledTimes(2);
  for (const call of vi.mocked(readinessFailure).mock.calls) {
    expect(call[3]).toBe(budget);
  }
});

test("a registry without a verifiable CA is a degraded registry-trust row that keeps the gate shut", async () => {
  vi.mocked(registryTrustProblem).mockResolvedValue(
    "registry CA is missing from kore-registry",
  );

  const rows = await platformStatus(repository, runner);
  const trust = rows.find((row) => row.name === registryTrustStatusName);

  expect(trust).toEqual({
    name: "registry-trust",
    namespace: "kore-registry",
    status: "degraded",
    detail: "registry CA is missing from kore-registry",
  });
});

test("a registry with its CA is a ready registry-trust row", async () => {
  const rows = await platformStatus(repository, runner);
  const trust = rows.find((row) => row.name === registryTrustStatusName);

  expect(trust).toEqual({
    name: "registry-trust",
    namespace: "kore-registry",
    status: "ready",
    detail: "registry CA present; every client verifies it",
  });
});
