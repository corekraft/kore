import { beforeEach, describe, expect, it, vi } from "vitest";
import { environments, readOverlay } from "../flag/index.js";
import type { FileSystem } from "../runtime/index.js";
import { localFlagOn } from "./local-flag.js";

vi.mock("../flag/index.js", () => ({
  environments: vi.fn(),
  readOverlay: vi.fn(),
}));

const fs = {} as FileSystem;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("localFlagOn", () => {
  it("is on only when the local overlay sets the named flag to true", async () => {
    vi.mocked(environments).mockResolvedValue(["local"]);
    vi.mocked(readOverlay).mockResolvedValue({
      features: { "a-flag": true, "b-flag": false },
    } as never);

    expect(await localFlagOn(fs, "/repo", "a-flag")).toBe(true);
    expect(await localFlagOn(fs, "/repo", "b-flag")).toBe(false);
    expect(readOverlay).toHaveBeenCalledWith(fs, "/repo", "local");
  });

  it("is off when the flag is absent", async () => {
    vi.mocked(environments).mockResolvedValue(["local"]);
    vi.mocked(readOverlay).mockResolvedValue({ features: {} } as never);

    expect(await localFlagOn(fs, "/repo", "a-flag")).toBe(false);
  });

  it("is off, and reads no overlay, when there is no local environment", async () => {
    vi.mocked(environments).mockResolvedValue(["managed-example"]);

    expect(await localFlagOn(fs, "/repo", "a-flag")).toBe(false);
    expect(readOverlay).not.toHaveBeenCalled();
  });
});
