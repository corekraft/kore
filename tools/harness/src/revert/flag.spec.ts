import { beforeEach, describe, expect, it, vi } from "vitest";
import { environments, readOverlay } from "../flag/index.js";
import type { FileSystem } from "../runtime/index.js";
import { revertFlagOn } from "./flag.js";

vi.mock("../flag/index.js", () => ({
  environments: vi.fn(),
  readOverlay: vi.fn(),
}));

const fs = {} as FileSystem;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("revertFlagOn", () => {
  it("is on only when the local overlay sets automatic-revert to true", async () => {
    vi.mocked(environments).mockResolvedValue(["local"]);
    vi.mocked(readOverlay).mockResolvedValue({
      features: { "automatic-revert": true },
    } as never);
    expect(await revertFlagOn(fs, "/repo")).toBe(true);
    expect(readOverlay).toHaveBeenCalledWith(fs, "/repo", "local");
  });

  it.each([
    ["false", { "automatic-revert": false }],
    ["absent", {}],
    ["a truthy non-boolean", { "automatic-revert": "yes" }],
  ])("is off when the flag is %s", async (_name, features) => {
    vi.mocked(environments).mockResolvedValue(["local"]);
    vi.mocked(readOverlay).mockResolvedValue({ features } as never);
    expect(await revertFlagOn(fs, "/repo")).toBe(false);
  });

  it("is off, and reads no overlay, when there is no local environment", async () => {
    vi.mocked(environments).mockResolvedValue(["managed-example"]);
    expect(await revertFlagOn(fs, "/repo")).toBe(false);
    expect(readOverlay).not.toHaveBeenCalled();
  });
});
