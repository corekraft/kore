// Docs: infra/plans/2-implementation.md#step-13-complete-lifecycle-orchestration
import { expect, test, vi } from "vitest";
import * as app from "./index.js";
import { appDown, appStatus } from "./app.js";
import { releaseArgs } from "./release.js";
import { appUp, appUpRelease } from "./up.js";
import { verifyLockedImageArgs } from "./verify.js";

vi.mock("./app.js");
vi.mock("./release.js");
vi.mock("./up.js");
vi.mock("./verify.js");

test("the app barrel exposes exactly the lifecycle entry points, the verification argument builder and the release arguments", () => {
  expect(Object.keys(app).sort()).toEqual([
    "appDown",
    "appStatus",
    "appUp",
    "appUpRelease",
    "releaseArgs",
    "verifyLockedImageArgs",
  ]);
  expect(app.appStatus).toBe(appStatus);
  expect(app.appDown).toBe(appDown);
  expect(app.appUp).toBe(appUp);
  expect(app.appUpRelease).toBe(appUpRelease);
  expect(app.verifyLockedImageArgs).toBe(verifyLockedImageArgs);
  expect(app.releaseArgs).toBe(releaseArgs);
});
