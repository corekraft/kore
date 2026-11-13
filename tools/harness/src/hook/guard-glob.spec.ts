import { describe, expect, it, vi } from "vitest";

const globFake = vi.hoisted(() => ({
  paths: [] as string[],
  calls: [] as { pattern: string; cwd: string }[],
}));

vi.mock("node:fs/promises", () => ({
  glob: async function* (pattern: string, options: { cwd: string }) {
    globFake.calls.push({ pattern, cwd: options.cwd });
    yield* globFake.paths;
  },
}));

const { anyPathMatches } = await import("./guard-glob.js");

describe("anyPathMatches", () => {
  it("is true when a path under the root matches the glob", async () => {
    globFake.paths = ["infra/a.yaml"];
    expect(await anyPathMatches("/repo", "infra/*.yaml")).toBe(true);
    expect(globFake.calls).toEqual([{ pattern: "infra/*.yaml", cwd: "/repo" }]);
  });

  it("is false when no path under the root matches, so the glob is unmatched", async () => {
    globFake.paths = [];
    expect(await anyPathMatches("/repo", "nope/*.zzz")).toBe(false);
  });
});
