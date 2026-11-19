// Docs: infra/plans/2-implementation.md#step-13-complete-lifecycle-orchestration
import { expect, test, vi } from "vitest";
import * as local from "./index.js";
import { withHostResolver } from "./host-resolver.js";
import { localDown, localUp } from "./local.js";

vi.mock("./host-resolver.js", () => ({ withHostResolver: vi.fn() }));
vi.mock("./local.js", () => ({ localUp: vi.fn(), localDown: vi.fn() }));

test("the local barrel exposes exactly the local up and down entry points and the host resolver wrapper", () => {
  expect(Object.keys(local).sort()).toEqual([
    "localDown",
    "localUp",
    "withHostResolver",
  ]);
  expect(local.localUp).toBe(localUp);
  expect(local.localDown).toBe(localDown);
  expect(local.withHostResolver).toBe(withHostResolver);
});
