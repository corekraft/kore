// Docs: infra/plans/2-implementation.md#step-13-complete-lifecycle-orchestration
import { expect, test, vi } from "vitest";
import * as local from "./index.js";
import { localDown, localUp } from "./local.js";

vi.mock("./local.js", () => ({ localUp: vi.fn(), localDown: vi.fn() }));

test("the local barrel exposes exactly the local up and down entry points", () => {
  expect(Object.keys(local).sort()).toEqual(["localDown", "localUp"]);
  expect(local.localUp).toBe(localUp);
  expect(local.localDown).toBe(localDown);
});
