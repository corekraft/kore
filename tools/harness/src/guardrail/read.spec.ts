// The read unit: finding and reading the inventory under a root or above a
// directory. Its collaborators are mocked: dirname (node:path), parseInventory
// (same domain), and the file system reader. MissingInventoryError and the
// path constant stay real.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { dirname } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INVENTORY_PATH,
  MissingInventoryError,
  parseInventory,
  type Inventory,
} from "./inventory.js";
import { findInventory, readInventory } from "./read.js";
import { fakeFileSystem } from "./guardrail-support.js";

vi.mock("node:path");
vi.mock("./inventory.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inventory.js")>()),
  parseInventory: vi.fn<typeof import("./inventory.js").parseInventory>(),
}));

const INVENTORY: Inventory = { guardrails: [] };
const MISSING = `${INVENTORY_PATH} is missing, so no guard rule has a declared mode. Restore it from git, then rerun.`;
// Built at collection, not inside a timed test: the first error a run builds pays
// a one-off cost that would otherwise land on whichever test is first.
const EXPECTED_MISSING = new MissingInventoryError(MISSING);
const ENOENT = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
const EACCES = Object.assign(new Error("EACCES"), { code: "EACCES" });

// The directory tree the walk climbs: /a/b/c, then /a/b, then /a, then the root.
const parents: Record<string, string> = {
  "/a/b/c": "/a/b",
  "/a/b": "/a",
  "/a": "/",
  "/": "/",
};

beforeEach(() => {
  vi.mocked(dirname).mockImplementation((path) => parents[path] ?? path);
  vi.mocked(parseInventory).mockReturnValue(INVENTORY);
});

describe("readInventory", () => {
  it("reads the inventory under the root and parses the text it read", async () => {
    const { readFile } = fakeFileSystem();
    readFile.mockResolvedValue("the text");
    expect(await readInventory(readFile, "/repo")).toBe(INVENTORY);
    expect(readFile.mock.calls).toEqual([["/repo/.claude/guardrails.yaml"]]);
    expect(vi.mocked(parseInventory).mock.calls).toEqual([["the text"]]);
  });

  it("names the missing path and how to restore it when the file is absent", async () => {
    const { readFile } = fakeFileSystem();
    readFile.mockRejectedValue(ENOENT);
    const caught: unknown = await readInventory(readFile, "/repo").catch(
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(MissingInventoryError);
    expect(caught).toEqual(EXPECTED_MISSING);
    expect(parseInventory).not.toHaveBeenCalled();
  });

  it("rethrows a read error other than a missing file, unchanged", async () => {
    const { readFile } = fakeFileSystem();
    readFile.mockRejectedValue(EACCES);
    await expect(readInventory(readFile, "/repo")).rejects.toBe(EACCES);
    expect(parseInventory).not.toHaveBeenCalled();
  });

  it("lets a parse error through, so the caller sees the inventory's own message", async () => {
    const { readFile } = fakeFileSystem();
    readFile.mockResolvedValue("{");
    const problem = new Error("bad inventory");
    vi.mocked(parseInventory).mockImplementation(() => {
      throw problem;
    });
    await expect(readInventory(readFile, "/repo")).rejects.toBe(problem);
  });
});

describe("findInventory", () => {
  it("returns the inventory from the start directory without climbing", async () => {
    const { readFile } = fakeFileSystem();
    readFile.mockResolvedValue("text");
    expect(await findInventory(readFile, "/a/b/c")).toBe(INVENTORY);
    expect(readFile.mock.calls).toEqual([["/a/b/c/.claude/guardrails.yaml"]]);
  });

  it("climbs through the parents until one holds the inventory", async () => {
    const { readFile } = fakeFileSystem();
    readFile.mockImplementation((path) =>
      path === "/a/.claude/guardrails.yaml"
        ? Promise.resolve("text")
        : Promise.reject(ENOENT),
    );
    expect(await findInventory(readFile, "/a/b/c")).toBe(INVENTORY);
    expect(readFile.mock.calls).toEqual([
      ["/a/b/c/.claude/guardrails.yaml"],
      ["/a/b/.claude/guardrails.yaml"],
      ["/a/.claude/guardrails.yaml"],
    ]);
  });

  it("stops at the first error that is not a missing file, without climbing", async () => {
    const { readFile } = fakeFileSystem();
    readFile.mockRejectedValue(EACCES);
    await expect(findInventory(readFile, "/a/b/c")).rejects.toBe(EACCES);
    expect(readFile.mock.calls).toEqual([["/a/b/c/.claude/guardrails.yaml"]]);
  });

  it("reports the missing inventory against the start, once it reaches the root", async () => {
    const { readFile } = fakeFileSystem();
    readFile.mockRejectedValue(ENOENT);
    await expect(findInventory(readFile, "/a/b/c")).rejects.toThrow(MISSING);
    expect(readFile.mock.calls).toEqual([
      ["/a/b/c/.claude/guardrails.yaml"],
      ["/a/b/.claude/guardrails.yaml"],
      ["/a/.claude/guardrails.yaml"],
      ["//.claude/guardrails.yaml"],
      ["/a/b/c/.claude/guardrails.yaml"],
    ]);
  });
});
