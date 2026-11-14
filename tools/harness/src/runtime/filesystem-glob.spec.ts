import { describe, expect, it, vi } from "vitest";

// The glob walk is replaced with a generator that records its arguments and
// counts how many paths the caller pulled, so the spec can see whether the
// walk stopped at the first match.
const walk = vi.hoisted(() => ({
  paths: [] as string[],
  pulled: 0,
  calls: [] as { pattern: string; options: unknown }[],
}));

vi.mock("node:fs/promises", () => ({
  glob: async function* (pattern: string, options: unknown) {
    walk.calls.push({ pattern, options });
    for (const path of walk.paths) {
      walk.pulled++;
      yield path;
    }
  },
}));

const { nodeFileSystem } = await import("./filesystem.js");

describe("nodeFileSystem.hasGlobMatch", () => {
  it("is true when a path matches, and stops walking at the first one", async () => {
    walk.paths = ["a.yaml", "b.yaml", "c.yaml"];
    walk.pulled = 0;
    expect(await nodeFileSystem.hasGlobMatch("/repo", "*.yaml")).toBe(true);
    expect(walk.pulled).toBe(1);
  });

  it("is false when no path matches, so the glob is unmatched", async () => {
    walk.paths = [];
    expect(await nodeFileSystem.hasGlobMatch("/repo", "*.zzz")).toBe(false);
  });

  it("walks from the given directory and never enters node_modules or .git", async () => {
    walk.paths = [];
    walk.calls = [];
    await nodeFileSystem.hasGlobMatch("/repo/wt", "*.yaml");
    expect(walk.calls).toEqual([
      {
        pattern: "*.yaml",
        options: { cwd: "/repo/wt", exclude: ["**/node_modules", "**/.git"] },
      },
    ]);
  });
});
