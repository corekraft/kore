// Docs: AGENTS.md "One owner per resource."
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { hostRoot, processAlive } from "../runtime/index.js";
import {
  clearForwardOwner,
  ownershipConflict,
  readForwardOwner,
  recordForwardOwner,
} from "./registry-forward-owner.js";
import { fakeRepository } from "./images-support.js";

vi.mock("node:fs");
vi.mock("node:fs/promises");
vi.mock("node:path");
vi.mock("../runtime/index.js");

const ownerPath = "/host/.kore/registry-forward/k3d-kore-local.json";
const owner = { pid: 4242, root: "/worktrees/a", starter: 7 };

beforeEach(() => {
  vi.mocked(hostRoot).mockReturnValue("/host");
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(dirname).mockReturnValue("/host/.kore/registry-forward");
});

test("recording an owner writes the forward's pid, the worktree and this process as the starter", async () => {
  await recordForwardOwner(
    fakeRepository({ kubeContext: "k3d-kore-local" }, "/worktrees/a"),
    4242,
  );

  expect(mkdir).toHaveBeenCalledWith("/host/.kore/registry-forward", {
    recursive: true,
  });
  expect(writeFile).toHaveBeenCalledWith(
    ownerPath,
    JSON.stringify({ pid: 4242, root: "/worktrees/a", starter: process.pid }),
  );
});

test("a well-formed owner record is read back exactly", async () => {
  vi.mocked(readFile).mockResolvedValue(JSON.stringify(owner));

  await expect(readForwardOwner("k3d-kore-local")).resolves.toEqual(owner);
  expect(readFile).toHaveBeenCalledWith(ownerPath, "utf8");
});

test("a record that is missing, unreadable or malformed reads as no owner", async () => {
  vi.mocked(readFile).mockRejectedValueOnce(new Error("ENOENT"));
  await expect(readForwardOwner("k3d-kore-local")).resolves.toBeUndefined();

  for (const bad of [
    { ...owner, pid: "4242" },
    { ...owner, root: 7 },
    { ...owner, starter: 1.5 },
    {},
  ]) {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(bad));
    await expect(readForwardOwner("k3d-kore-local")).resolves.toBeUndefined();
  }
});

test("clearing the owner removes its record and ignores a record that is already gone", async () => {
  await clearForwardOwner("k3d-kore-local");

  expect(rm).toHaveBeenCalledWith(ownerPath, { force: true });
});

test("no recorded owner conflicts with nothing", () => {
  expect(ownershipConflict(undefined, "/worktrees/a")).toBeUndefined();
});

test("another worktree that still exists conflicts, and the message says where to stop from", () => {
  vi.mocked(existsSync).mockReturnValue(true);

  expect(ownershipConflict(owner, "/worktrees/b")).toBe(
    "it was started from /worktrees/a, so stop it from there",
  );
  expect(existsSync).toHaveBeenCalledWith("/worktrees/a");
});

test("another worktree that is gone no longer owns the forward", () => {
  vi.mocked(existsSync).mockReturnValue(false);

  expect(ownershipConflict(owner, "/worktrees/b")).toBeUndefined();
});

test("this worktree's own record conflicts only with a live kore process other than this one", () => {
  vi.mocked(processAlive).mockReturnValue(true);

  expect(ownershipConflict(owner, "/worktrees/a")).toBe(
    "it was started by kore process 7 in this worktree, so stop it from there",
  );
  expect(processAlive).toHaveBeenCalledWith(7);
});

test("the starting process itself never conflicts with its own record", () => {
  const own = { ...owner, starter: process.pid };
  vi.mocked(processAlive).mockReturnValue(true);

  expect(ownershipConflict(own, "/worktrees/a")).toBeUndefined();
});

test("a starter that has exited no longer owns the forward in this worktree", () => {
  vi.mocked(processAlive).mockReturnValue(false);

  expect(ownershipConflict(owner, "/worktrees/a")).toBeUndefined();
});
