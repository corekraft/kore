// Docs: infra/plans/14-test-tiers.md#step-2-pilots
import { beforeEach, expect, test, vi } from "vitest";
import type { Repository } from "../config/index.js";
import { assertExpectedCluster } from "../cluster/index.js";
import type { Runner } from "../runtime/index.js";
import {
  assertAdmissionGateOpen,
  ensureClosedAdmissionGate,
  openAdmissionGate,
  readAdmissionGate,
} from "./admission-gate.js";
import {
  evaluateReadiness,
  readinessFailureSummary,
  recordReadinessEvidence,
  tryRecordReadinessEvidence,
  type ReadinessEvidence,
} from "./readiness-manifest.js";
import {
  closeGateIfDegraded,
  openApplicationAdmission,
} from "./readiness-gate.js";
import { imageInventoryStatusName, platformStatus } from "./status.js";

vi.mock("../cluster/index.js");
vi.mock("./admission-gate.js");
vi.mock("./readiness-manifest.js");
vi.mock("./status.js");

const repository = { environment: { name: "local" } } as unknown as Repository;
const runner = {} as Runner;

const openEvidence = {
  state: "open",
  failures: [],
} as unknown as ReadinessEvidence;

const failingEvidence = {
  state: "closed",
  failures: [{ name: "policy", detail: "policy not ready" }],
} as unknown as ReadinessEvidence;

let stderr: string[];

beforeEach(() => {
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((text) => {
    stderr.push(String(text));
    return true;
  });
  vi.mocked(platformStatus).mockResolvedValue([]);
  vi.mocked(evaluateReadiness).mockReturnValue(openEvidence);
  vi.mocked(readinessFailureSummary).mockReturnValue("policy not ready");
  vi.mocked(readAdmissionGate).mockResolvedValue({ state: "open" } as never);
  vi.mocked(assertAdmissionGateOpen).mockResolvedValue("open");
  vi.mocked(assertExpectedCluster).mockResolvedValue(undefined);
});

test("the image inventory detail is written to the log before readiness is judged", async () => {
  vi.mocked(platformStatus).mockResolvedValue([
    { name: imageInventoryStatusName, detail: "2 images unpinned" } as never,
  ]);

  await openApplicationAdmission(repository, runner);

  expect(stderr).toEqual(["image inventory: 2 images unpinned\n"]);
});

test("a run with no image inventory row writes no inventory line", async () => {
  await openApplicationAdmission(repository, runner);

  expect(stderr).toEqual([]);
});

test("a run whose evidence is open records the evidence before it opens the gate, then asserts the gate is open", async () => {
  const evidence = await openApplicationAdmission(repository, runner);

  expect(evidence).toBe(openEvidence);
  const recorded = vi.mocked(recordReadinessEvidence).mock
    .invocationCallOrder[0];
  const opened = vi.mocked(openAdmissionGate).mock.invocationCallOrder[0];
  const asserted = vi.mocked(assertAdmissionGateOpen).mock
    .invocationCallOrder[0];
  expect(recorded).toBeLessThan(opened!);
  expect(opened).toBeLessThan(asserted!);
});

test("a run whose evidence is not open closes the gate and never opens it", async () => {
  vi.mocked(evaluateReadiness).mockReturnValue(failingEvidence);

  await expect(openApplicationAdmission(repository, runner)).rejects.toThrow();

  expect(ensureClosedAdmissionGate).toHaveBeenCalledWith(repository, runner);
  expect(openAdmissionGate).not.toHaveBeenCalled();
  expect(recordReadinessEvidence).not.toHaveBeenCalled();
});

test("a closed run fails naming the summary of its failures and the command to rerun", async () => {
  vi.mocked(evaluateReadiness).mockReturnValue(failingEvidence);

  await expect(openApplicationAdmission(repository, runner)).rejects.toThrow(
    "the application admission gate stays closed: policy not ready. Fix the failing prerequisite and rerun kore platform up",
  );
});

test("a closed run records its evidence best-effort, after the gate is closed", async () => {
  vi.mocked(evaluateReadiness).mockReturnValue(failingEvidence);

  await expect(openApplicationAdmission(repository, runner)).rejects.toThrow();

  const closed = vi.mocked(ensureClosedAdmissionGate).mock
    .invocationCallOrder[0];
  const recorded = vi.mocked(tryRecordReadinessEvidence).mock
    .invocationCallOrder[0];
  expect(closed).toBeLessThan(recorded!);
  expect(vi.mocked(tryRecordReadinessEvidence).mock.calls[0]?.[2]).toBe(
    failingEvidence,
  );
});

test("a closeGateIfDegraded check first asserts the expected cluster and reads the platform status", async () => {
  await closeGateIfDegraded(repository, runner);

  expect(assertExpectedCluster).toHaveBeenCalledWith(repository, runner);
  expect(platformStatus).toHaveBeenCalledWith(repository, runner);
});

test("a healthy platform is not closed and reads no gate", async () => {
  const result = await closeGateIfDegraded(repository, runner);

  expect(result).toEqual({
    closed: false,
    evidence: openEvidence,
    failures: [],
  });
  expect(readAdmissionGate).not.toHaveBeenCalled();
  expect(ensureClosedAdmissionGate).not.toHaveBeenCalled();
});

test("a degraded platform with no gate to close reports nothing closed and writes nothing", async () => {
  vi.mocked(evaluateReadiness).mockReturnValue(failingEvidence);
  vi.mocked(readAdmissionGate).mockResolvedValue(undefined);

  const result = await closeGateIfDegraded(repository, runner);

  expect(result.closed).toBe(false);
  expect(ensureClosedAdmissionGate).not.toHaveBeenCalled();
  expect(recordReadinessEvidence).not.toHaveBeenCalled();
});

test("a degraded platform with an open gate closes it, records the evidence and reports the failures", async () => {
  vi.mocked(evaluateReadiness).mockReturnValue(failingEvidence);
  vi.mocked(readAdmissionGate).mockResolvedValue({ state: "open" } as never);

  const result = await closeGateIfDegraded(repository, runner);

  expect(result).toEqual({
    closed: true,
    evidence: failingEvidence,
    failures: failingEvidence.failures,
  });
  expect(ensureClosedAdmissionGate).toHaveBeenCalledWith(repository, runner);
  expect(tryRecordReadinessEvidence).toHaveBeenCalledTimes(1);
});

test("a degraded platform whose gate is already closed reports nothing newly closed", async () => {
  vi.mocked(evaluateReadiness).mockReturnValue(failingEvidence);
  vi.mocked(readAdmissionGate).mockResolvedValue({ state: "closed" } as never);

  const result = await closeGateIfDegraded(repository, runner);

  expect(result.closed).toBe(false);
  expect(ensureClosedAdmissionGate).toHaveBeenCalledTimes(1);
});

test("a degraded platform never opens the gate: opening is bootstrap's alone", async () => {
  vi.mocked(evaluateReadiness).mockReturnValue(failingEvidence);
  vi.mocked(readAdmissionGate).mockResolvedValue({ state: "open" } as never);

  await closeGateIfDegraded(repository, runner);

  expect(openAdmissionGate).not.toHaveBeenCalled();
});
