// Docs: infra/plans/14-test-tiers.md#step-2-pilots
import { beforeEach, expect, test, vi } from "vitest";
import {
  crdOwners,
  providerOwnsCrd,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { backupStatus } from "./backup-status.js";
import { capacityStatus } from "./capacity-status.js";
import {
  crdOwnershipStatus,
  platformStatusReport,
} from "./crd-ownership-status.js";
import { errorMessage } from "./probe.js";
import { platformStatus } from "./status.js";

vi.mock("../config/index.js");
vi.mock("./backup-status.js");
vi.mock("./capacity-status.js");
vi.mock("./probe.js");
vi.mock("./status.js");

// Docs: docs/decisions/0057-runtime-crd-ownership.md

type Run = Runner["run"];

const repository = {
  environment: { kubeContext: "k3d-kore-local", providerOwnedCRDGroups: [] },
  catalog: { components: [] },
} as unknown as Repository;

/** A typed runner answering `kubectl get crd` with the given list, or throwing the given error. */
function fakeRunner(reply: string | Error) {
  const run = vi.fn<Run>(async () => {
    if (reply instanceof Error) {
      throw reply;
    }
    return { stdout: reply, stderr: "", code: 0 };
  });
  return { runner: { run } as Runner, run };
}

/** A `kubectl get crd --output json` list of the named CRDs, in the order given. */
function crdList(...names: string[]): string {
  return JSON.stringify({
    items: names.map((name) => ({ metadata: { name } })),
  });
}

beforeEach(() => {
  vi.mocked(crdOwners).mockReturnValue(["gateway"]);
  vi.mocked(providerOwnsCrd).mockReturnValue(false);
  vi.mocked(errorMessage).mockImplementation((error) =>
    error instanceof Error ? error.message : String(error),
  );
  vi.mocked(platformStatus).mockResolvedValue([]);
  vi.mocked(capacityStatus).mockResolvedValue({ name: "capacity" } as never);
  vi.mocked(backupStatus).mockResolvedValue(undefined);
});

test("the CRD list is read with the environment's context, in JSON, and sorted by name", async () => {
  const { runner, run } = fakeRunner(crdList("b.example.io", "a.example.io"));

  await crdOwnershipStatus(repository, runner);

  expect(run).toHaveBeenCalledWith(
    "kubectl",
    ["--context", "k3d-kore-local", "get", "crd", "--output", "json"],
    { capture: true },
  );
});

test("a CRD list that cannot be read is missing, naming the error", async () => {
  const { runner } = fakeRunner(new Error("forbidden: crds is forbidden"));

  expect(await crdOwnershipStatus(repository, runner)).toEqual({
    name: "crd-ownership",
    namespace: "cluster",
    status: "missing",
    detail: "CRDs could not be listed: forbidden: crds is forbidden",
  });
});

test("a CRD list that is not JSON is missing rather than thrown", async () => {
  const { runner } = fakeRunner("<html>forbidden</html>");

  const row = await crdOwnershipStatus(repository, runner);

  expect(row.status).toBe("missing");
  expect(row.detail).toMatch(/^CRDs could not be listed: /);
});

test("every CRD with exactly one catalog owner is ready and reports the total", async () => {
  const { runner } = fakeRunner(crdList("a.example.io", "b.example.io"));

  expect(await crdOwnershipStatus(repository, runner)).toEqual({
    name: "crd-ownership",
    namespace: "cluster",
    status: "ready",
    detail: "all 2 CRDs have exactly one catalog owner",
    crds: { total: 2, unowned: [], multiple: [], providerOwned: [] },
  });
});

test("a CRD no catalog component owns is degraded and names the declarations that would fix it", async () => {
  vi.mocked(crdOwners).mockReturnValue([]);
  const { runner } = fakeRunner(crdList("fakes.example.io"));

  expect(await crdOwnershipStatus(repository, runner)).toEqual({
    name: "crd-ownership",
    namespace: "cluster",
    status: "degraded",
    detail:
      "fakes.example.io has no catalog owner. Declare each in one component's ownsCRDs or ownsCRDGroups, or in the environment's providerOwnedCRDGroups when the provider ships it",
    crds: {
      total: 1,
      unowned: ["fakes.example.io"],
      multiple: [],
      providerOwned: [],
    },
  });
});

test("a CRD with several catalog owners is degraded and names every owner", async () => {
  vi.mocked(crdOwners).mockReturnValue(["gateway", "policy"]);
  const { runner } = fakeRunner(crdList("shared.example.io"));

  const row = await crdOwnershipStatus(repository, runner);

  expect(row.status).toBe("degraded");
  expect(row.detail).toMatch(
    /^shared\.example\.io has several owners: gateway and policy\./,
  );
  expect(row.crds?.multiple).toEqual([
    { name: "shared.example.io", owners: ["gateway", "policy"] },
  ]);
});

test("a provider-owned CRD is counted as provider-owned and is never looked up in the catalog", async () => {
  vi.mocked(providerOwnsCrd).mockReturnValue(true);
  const { runner } = fakeRunner(crdList("cloud.example.io"));

  const row = await crdOwnershipStatus(repository, runner);

  expect(crdOwners).not.toHaveBeenCalled();
  expect(row).toEqual({
    name: "crd-ownership",
    namespace: "cluster",
    status: "ready",
    detail:
      "all 1 CRDs have exactly one owner: 0 catalog-owned, 1 provider-owned",
    crds: {
      total: 1,
      unowned: [],
      multiple: [],
      providerOwned: ["cloud.example.io"],
    },
  });
});

test("a CRD item with no name is not counted", async () => {
  const { runner } = fakeRunner(
    JSON.stringify({
      items: [{ metadata: {} }, { metadata: { name: "a.example.io" } }],
    }),
  );

  const row = await crdOwnershipStatus(repository, runner);

  expect(row.crds?.total).toBe(1);
});

test("the report appends the CRD, capacity and backup rows after the platform rows when unfiltered", async () => {
  vi.mocked(platformStatus).mockResolvedValue([{ name: "gateway" } as never]);
  vi.mocked(backupStatus).mockResolvedValue({ name: "backups" } as never);
  const { runner } = fakeRunner(crdList("a.example.io"));

  const rows = await platformStatusReport(repository, runner);

  expect(rows.map((row) => row.name)).toEqual([
    "gateway",
    "crd-ownership",
    "capacity",
    "backups",
  ]);
});

test("the report omits the backup row when the environment has no objective", async () => {
  vi.mocked(platformStatus).mockResolvedValue([{ name: "gateway" } as never]);
  vi.mocked(backupStatus).mockResolvedValue(undefined);
  const { runner } = fakeRunner(crdList("a.example.io"));

  const rows = await platformStatusReport(repository, runner);

  expect(rows.map((row) => row.name)).toEqual([
    "gateway",
    "crd-ownership",
    "capacity",
  ]);
});

test("a filtered report returns only the component rows and reads none of the audit rows", async () => {
  vi.mocked(platformStatus).mockResolvedValue([{ name: "gateway" } as never]);
  const { runner, run } = fakeRunner(crdList("a.example.io"));

  const rows = await platformStatusReport(repository, runner, ["gateway"]);

  expect(platformStatus).toHaveBeenCalledWith(repository, runner, ["gateway"]);
  expect(rows.map((row) => row.name)).toEqual(["gateway"]);
  expect(run).not.toHaveBeenCalled();
  expect(capacityStatus).not.toHaveBeenCalled();
  expect(backupStatus).not.toHaveBeenCalled();
});
