// The local overlay's flag read: the overlay reader and the environment list are mocked, so the spec
// tests only the decision the guard makes from them.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { environments, FlagError, readOverlay } from "../flag/index.js";
import type { FileSystem } from "../runtime/index.js";
import { localFlagOn } from "./guard-local-flag.js";

vi.mock("../flag/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flag/index.js")>()),
  environments: vi.fn(),
  readOverlay: vi.fn(),
}));

/** A typed stand-in for the file system, whose members the unit never reads itself. */
const fs = {} as FileSystem;
type Overlay = Awaited<ReturnType<typeof readOverlay>>;
const overlay = (features: Record<string, boolean>): Overlay => ({
  environment: "local",
  path: "infra/environments/local/environment.yaml",
  text: "",
  features,
});

beforeEach(() => {
  vi.mocked(environments).mockResolvedValue(["local"]);
  vi.mocked(readOverlay).mockResolvedValue(overlay({ "some-flag": true }));
});

describe("localFlagOn", () => {
  it("is true when the local overlay turns the flag on", async () => {
    expect(await localFlagOn(fs, "/repo", "some-flag")).toBe(true);
  });

  it("reads the local overlay of the root it is given", async () => {
    await localFlagOn(fs, "/repo", "some-flag");
    expect(readOverlay).toHaveBeenCalledWith(fs, "/repo", "local");
  });

  it.each([
    ["off", { "some-flag": false }],
    ["not named", {}],
    ["named for another flag only", { "other-flag": true }],
  ])("is false when the flag is %s", async (_label, features) => {
    vi.mocked(readOverlay).mockResolvedValue(overlay(features));
    expect(await localFlagOn(fs, "/repo", "some-flag")).toBe(false);
  });

  it("is false, and reads no overlay, when there is no local environment", async () => {
    vi.mocked(environments).mockResolvedValue([]);
    expect(await localFlagOn(fs, "/repo", "some-flag")).toBe(false);
    expect(readOverlay).not.toHaveBeenCalled();
  });

  it.each([
    ["a malformed overlay", new FlagError("bad overlay")],
    ["an unreadable one", new Error("EACCES")],
  ])("fails closed, not crashing the guard, on %s", async (_label, error) => {
    vi.mocked(readOverlay).mockRejectedValue(error);
    expect(await localFlagOn(fs, "/repo", "some-flag")).toBe(false);
  });
});
