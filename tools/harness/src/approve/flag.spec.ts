import { beforeEach, describe, expect, it, vi } from "vitest";
import { environments, readOverlay } from "../flag/index.js";
import type { FileSystem } from "../runtime/index.js";
import { APPROVE_FLAG, approveFlagOn } from "./flag.js";

vi.mock("../flag/index.js", () => ({
  environments: vi.fn(),
  readOverlay: vi.fn(),
}));

const fs = {} as FileSystem;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("approveFlagOn", () => {
  it("is named automatic-approval", () => {
    expect(APPROVE_FLAG).toBe("automatic-approval");
  });

  it("is on only when the local overlay sets the flag to true", async () => {
    vi.mocked(environments).mockResolvedValue(["local"]);
    vi.mocked(readOverlay).mockResolvedValue({
      features: { "automatic-approval": true },
    } as never);

    expect(await approveFlagOn(fs, "/repo")).toBe(true);
  });

  it.each([
    ["false", { "automatic-approval": false }],
    ["absent", {}],
    ["a truthy non-boolean", { "automatic-approval": "yes" }],
  ])("is off when the flag is %s", async (_n, features) => {
    vi.mocked(environments).mockResolvedValue(["local"]);
    vi.mocked(readOverlay).mockResolvedValue({ features } as never);

    expect(await approveFlagOn(fs, "/repo")).toBe(false);
  });

  it("is off, reading no overlay, when there is no local environment", async () => {
    vi.mocked(environments).mockResolvedValue(["managed-example"]);

    expect(await approveFlagOn(fs, "/repo")).toBe(false);
    expect(readOverlay).not.toHaveBeenCalled();
  });
});
