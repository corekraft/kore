import { access } from "node:fs/promises";
import { expect, test, vi } from "vitest";
import { exists } from "./files.js";

vi.mock("node:fs/promises");

test("a path the process can access exists, and the check asks about exactly that path", async () => {
  vi.mocked(access).mockResolvedValue(undefined);
  expect(await exists("/repo/infra/catalog/components.yaml")).toBe(true);
  expect(vi.mocked(access).mock.calls).toEqual([
    ["/repo/infra/catalog/components.yaml"],
  ]);
});

test("a missing path does not exist, and the check does not throw", async () => {
  vi.mocked(access).mockRejectedValue(
    Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
  );
  expect(await exists("/repo/missing.yaml")).toBe(false);
});

test("any failure to access a path reads as absent rather than an error", async () => {
  vi.mocked(access).mockRejectedValue(
    Object.assign(new Error("EACCES"), { code: "EACCES" }),
  );
  await expect(exists("/repo/locked.yaml")).resolves.toBe(false);
});
