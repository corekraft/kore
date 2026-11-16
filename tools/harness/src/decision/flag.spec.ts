import { describe, expect, it, vi } from "vitest";
import { environments, readOverlay } from "../flag/index.js";
import type { FileSystem } from "../runtime/index.js";
import { decisionFlagOn } from "./flag.js";

vi.mock("../flag/index.js", () => ({
  environments: vi.fn(),
  readOverlay: vi.fn(),
}));

const fs = {} as FileSystem;

describe("decisionFlagOn", () => {
  it("is on only when the local overlay sets decision-advisor to true", async () => {
    vi.mocked(environments).mockResolvedValue(["local"]);
    vi.mocked(readOverlay).mockResolvedValue({
      features: { "decision-advisor": true },
    } as never);

    expect(await decisionFlagOn(fs, "/repo")).toBe(true);
    expect(readOverlay).toHaveBeenCalledWith(fs, "/repo", "local");
  });

  it.each([
    ["false", { "decision-advisor": false }],
    ["absent", {}],
    ["a truthy non-boolean", { "decision-advisor": "yes" }],
  ])("is off when the flag is %s", async (_name, features) => {
    vi.mocked(environments).mockResolvedValue(["local"]);
    vi.mocked(readOverlay).mockResolvedValue({ features } as never);

    expect(await decisionFlagOn(fs, "/repo")).toBe(false);
  });

  it("is off, and reads no overlay, when there is no local environment", async () => {
    vi.mocked(environments).mockResolvedValue(["managed-example"]);

    expect(await decisionFlagOn(fs, "/repo")).toBe(false);
    expect(readOverlay).not.toHaveBeenCalled();
  });
});
