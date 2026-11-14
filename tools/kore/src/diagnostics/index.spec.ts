// Docs: infra/plans/2-implementation.md#step-6-repository-and-local-cluster-foundation
import { expect, test, vi } from "vitest";
import * as diagnostics from "./index.js";
import { doctor, doctorFailed } from "./doctor.js";
import { validatePortability } from "./portability.js";

// Factories, so neither real unit loads just to be replaced.
vi.mock("./doctor.js", () => ({ doctor: vi.fn(), doctorFailed: vi.fn() }));
vi.mock("./portability.js", () => ({ validatePortability: vi.fn() }));

test("the diagnostics barrel exposes exactly the doctor and portability entry points", () => {
  expect(Object.keys(diagnostics).sort()).toEqual([
    "doctor",
    "doctorFailed",
    "validatePortability",
  ]);
  expect(diagnostics.doctor).toBe(doctor);
  expect(diagnostics.doctorFailed).toBe(doctorFailed);
  expect(diagnostics.validatePortability).toBe(validatePortability);
});
