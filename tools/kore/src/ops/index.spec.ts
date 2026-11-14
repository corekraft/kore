// Docs: infra/plans/2-implementation.md#step-15-operational-hardening-and-release
import { expect, test, vi } from "vitest";
import * as ops from "./index.js";
import { OPS_ACTIONS, opsReport } from "./report.js";
import { loadRecovery } from "./recovery.js";

vi.mock("./report.js");
vi.mock("./recovery.js");

test("the ops barrel exposes exactly the report and recovery entry points", () => {
  expect(Object.keys(ops).sort()).toEqual([
    "OPS_ACTIONS",
    "loadRecovery",
    "opsReport",
  ]);
  expect(ops.OPS_ACTIONS).toBe(OPS_ACTIONS);
  expect(ops.opsReport).toBe(opsReport);
  expect(ops.loadRecovery).toBe(loadRecovery);
});
