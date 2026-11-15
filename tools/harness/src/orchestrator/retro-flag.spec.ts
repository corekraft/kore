import { beforeEach, describe, expect, it, vi } from "vitest";
import { environments, readOverlay } from "../flag/index.js";
import type { FileSystem } from "../runtime/index.js";
import { retroFlagOn } from "./retro-flag.js";

vi.mock("../flag/index.js", () => ({
  environments: vi.fn(),
  readOverlay: vi.fn(),
}));

const fs = {} as FileSystem;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("retroFlagOn", () => {
  it("is on only when the local overlay sets automatic-retro to true", async () => {
    vi.mocked(environments).mockResolvedValue(["local"]);
    vi.mocked(readOverlay).mockResolvedValue({
      features: { "automatic-retro": true },
    } as never);

    expect(await retroFlagOn(fs, "/repo")).toBe(true);
    expect(readOverlay).toHaveBeenCalledWith(fs, "/repo", "local");
  });

  it.each([
    ["false", { "automatic-retro": false }],
    ["absent", {}],
    ["a truthy non-boolean", { "automatic-retro": "yes" }],
  ])("is off when the flag is %s", async (_name, features) => {
    vi.mocked(environments).mockResolvedValue(["local"]);
    vi.mocked(readOverlay).mockResolvedValue({ features } as never);

    expect(await retroFlagOn(fs, "/repo")).toBe(false);
  });

  it("is off, and reads no overlay, when there is no local environment", async () => {
    vi.mocked(environments).mockResolvedValue(["managed-example"]);

    expect(await retroFlagOn(fs, "/repo")).toBe(false);
    expect(readOverlay).not.toHaveBeenCalled();
  });
});
