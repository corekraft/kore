import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { writePlatformState } from "./platform-state.js";
import { fakeRepository } from "./platform-support.js";

vi.mock("node:fs/promises");
vi.mock("node:path");

const repository = fakeRepository({
  name: "local",
  kubeContext: "k3d-kore-local",
});

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T08:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

test("the platform state is written to the environment's file under the repository's state directory", async () => {
  await writePlatformState(repository, "ready");
  expect(mkdir).toHaveBeenCalledWith("/repo/.kore/state", { recursive: true });
  expect(writeFile).toHaveBeenCalledWith(
    "/repo/.kore/state/local.json",
    expect.any(String),
  );
});

test("the platform state records the environment, its context, the status and the time it was reconciled", async () => {
  await writePlatformState(repository, "ready");
  expect(writeFile).toHaveBeenCalledWith(
    "/repo/.kore/state/local.json",
    `{
  "environment": "local",
  "context": "k3d-kore-local",
  "status": "ready",
  "reconciledAt": "2026-11-14T08:00:00.000Z"
}`,
  );
});

test("the state directory exists before the state file is written", async () => {
  await writePlatformState(repository, "degraded");
  expect(vi.mocked(mkdir).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(writeFile).mock.invocationCallOrder[0]!,
  );
});

test("a failed directory create stops the write and reports the failure", async () => {
  vi.mocked(mkdir).mockRejectedValueOnce(new Error("EACCES: state"));
  await expect(writePlatformState(repository, "ready")).rejects.toThrow(
    "EACCES: state",
  );
  expect(writeFile).not.toHaveBeenCalled();
});
