// The session commands' reader of the signed-main-sends flag: the local overlay of
// the main checkout decides it, and no overlay, no checkout or an unwritten flag means
// off, so delivery keeps today's confirmation (ADR 0123).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { environments, FlagError, readOverlay } from "../flag/index.js";
import { mainRoot, type CliDeps, type FileSystem } from "../runtime/index.js";
import { signedMainSendsOn } from "./signed-sends.js";

vi.mock("../flag/index.js", async (original) => ({
  ...(await original<typeof import("../flag/index.js")>()),
  environments: vi.fn(),
  readOverlay: vi.fn(),
}));
vi.mock("../runtime/index.js", async (original) => ({
  ...(await original<typeof import("../runtime/index.js")>()),
  mainRoot: vi.fn(),
}));

const ROOT = "/repo";
const FS = {} as FileSystem;
const DEPS = { fs: FS } as unknown as CliDeps;

/** The local overlay as the flag domain reads it, with the given features. */
const overlay = (
  features: Record<string, boolean>,
): Awaited<ReturnType<typeof readOverlay>> => ({
  environment: "local",
  path: "infra/environments/local/environment.yaml",
  text: "",
  features,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mainRoot).mockResolvedValue(ROOT);
  vi.mocked(environments).mockResolvedValue(["local"]);
});

describe("signed-main-sends flag for session send and notify", () => {
  it("is on when the main checkout's local overlay turns the flag on", async () => {
    vi.mocked(readOverlay).mockResolvedValue(
      overlay({ "signed-main-sends": true }),
    );

    expect(await signedMainSendsOn(DEPS)).toBe(true);
    expect(vi.mocked(readOverlay).mock.calls).toEqual([[FS, ROOT, "local"]]);
  });

  it("is off when the local overlay leaves the flag false", async () => {
    vi.mocked(readOverlay).mockResolvedValue(
      overlay({ "signed-main-sends": false }),
    );

    expect(await signedMainSendsOn(DEPS)).toBe(false);
  });

  it("is off when the local overlay does not name the flag at all", async () => {
    vi.mocked(readOverlay).mockResolvedValue(overlay({}));

    expect(await signedMainSendsOn(DEPS)).toBe(false);
  });

  it("is off when no local overlay exists, and reads none", async () => {
    vi.mocked(environments).mockResolvedValue([]);

    expect(await signedMainSendsOn(DEPS)).toBe(false);
    expect(readOverlay).not.toHaveBeenCalled();
  });

  it("is off when the main checkout cannot be found, and reads no overlay", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);

    expect(await signedMainSendsOn(DEPS)).toBe(false);
    expect(environments).not.toHaveBeenCalled();
    expect(readOverlay).not.toHaveBeenCalled();
  });

  it("lets a malformed overlay's flag error reach the caller", async () => {
    vi.mocked(readOverlay).mockRejectedValue(
      new FlagError("The local overlay is malformed."),
    );

    await expect(signedMainSendsOn(DEPS)).rejects.toThrow(
      "The local overlay is malformed.",
    );
  });
});
