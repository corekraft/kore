import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { hostRoot, lockScope } from "./host-locks.js";

// Docs: AGENTS.md "Mutations are serialized per environment."

vi.mock("node:os");
vi.mock("node:path");

afterEach(() => {
  vi.unstubAllEnvs();
});

test("an empty KORE_HOST_ROOT is unset, so locks stay at the shared home path", () => {
  vi.stubEnv("KORE_HOST_ROOT", "");
  vi.mocked(homedir).mockReturnValue("/home/kore");
  vi.mocked(isAbsolute).mockReturnValue(true);
  expect(hostRoot()).toBe("/home/kore");
  expect(vi.mocked(isAbsolute).mock.calls).toEqual([["/home/kore"]]);
});

test("an absolute KORE_HOST_ROOT relocates the locks, never reading the home directory", () => {
  vi.stubEnv("KORE_HOST_ROOT", "/somewhere/else");
  vi.mocked(isAbsolute).mockReturnValue(true);
  expect(hostRoot()).toBe("/somewhere/else");
  expect(vi.mocked(homedir)).not.toHaveBeenCalled();
});

test("a relative KORE_HOST_ROOT is refused, because it would make locks per worktree again", () => {
  vi.stubEnv("KORE_HOST_ROOT", "relative/dir");
  vi.mocked(isAbsolute).mockReturnValue(false);
  expect(() => hostRoot()).toThrow(
    'KORE_HOST_ROOT must be an absolute path, got "relative/dir"; a relative root would put the locks back per worktree. Set it to an absolute directory or unset it',
  );
});

test("a k3d environment's lock is keyed by its cluster, so worktrees that share it share the lock", () => {
  expect(lockScope({ name: "local", k3d: { clusterName: "kore-local" } })).toBe(
    "kore-local",
  );
});

test("an environment without a cluster is keyed by its own name", () => {
  expect(lockScope({ name: "scratch" })).toBe("scratch");
});
