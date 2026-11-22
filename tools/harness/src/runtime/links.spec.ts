import { realpath } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { nodeLinks } from "./links.js";

vi.mock("node:fs/promises");

describe("nodeLinks.realpath", () => {
  it("resolves a path to its real location, following every link on the way", async () => {
    vi.mocked(realpath).mockResolvedValue("/real/r/a");

    expect(await nodeLinks.realpath("/r/link/a")).toBe("/real/r/a");
    expect(vi.mocked(realpath).mock.calls).toEqual([["/r/link/a"]]);
  });
});
