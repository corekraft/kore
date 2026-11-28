// Docs: docs/decisions/0149-a-feature-flag-retires-after-it-soaks-on-in-every-environment-it-applies-to.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  environments,
  readOverlay,
  withoutFlag,
  withoutManifestEntry,
  type Overlay,
} from "../flag/index.js";
import type { FileSystem } from "../runtime/index.js";
import { retireEdits } from "./flag-retire-edits.js";

vi.mock("../flag/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flag/index.js")>()),
  environments: vi.fn(),
  readOverlay: vi.fn(),
  withoutFlag: vi.fn(),
  withoutManifestEntry: vi.fn(),
}));

const FLAG = "suborg-tenancy";
const BASE = "/repo";
const MANIFEST_TEXT = '{ "flags": [] }';

/** An overlay for one environment, declaring the given features. */
function overlayOf(
  environment: string,
  features: Record<string, boolean>,
): Overlay {
  return {
    environment,
    path: `infra/environments/${environment}/environment.yaml`,
    text: `TEXT of ${environment}`,
    features,
    production: false,
  };
}

const fs = {} as FileSystem;

beforeEach(() => {
  vi.mocked(environments).mockResolvedValue(["local", "vps"]);
  vi.mocked(readOverlay).mockImplementation((_fs, _base, name) =>
    Promise.resolve(
      name === "local"
        ? overlayOf("local", { [FLAG]: true, "acme-dns01": true })
        : overlayOf("vps", { "acme-dns01": false }),
    ),
  );
  vi.mocked(withoutFlag).mockImplementation(
    (overlay) => `WITHOUT ${FLAG} in ${overlay.environment}`,
  );
  vi.mocked(withoutManifestEntry).mockReturnValue("MANIFEST WITHOUT");
});

describe("retireEdits", () => {
  it("rewrites each overlay that declares the flag, and no other", async () => {
    const edits = await retireEdits(fs, BASE, FLAG, MANIFEST_TEXT);
    expect(edits.overlays).toEqual([
      {
        path: "infra/environments/local/environment.yaml",
        text: `WITHOUT ${FLAG} in local`,
      },
    ]);
    expect(withoutFlag).toHaveBeenCalledTimes(1);
  });

  it("rewrites the manifest by removing the flag's entry from the text it was given", async () => {
    const edits = await retireEdits(fs, BASE, FLAG, MANIFEST_TEXT);
    expect(withoutManifestEntry).toHaveBeenCalledWith(MANIFEST_TEXT, FLAG);
    expect(edits.manifest).toEqual({
      path: "infra/catalog/flags.yaml",
      text: "MANIFEST WITHOUT",
    });
  });

  it("reads every environment's overlay through the environments the repository holds", async () => {
    await retireEdits(fs, BASE, FLAG, MANIFEST_TEXT);
    expect(environments).toHaveBeenCalledWith(fs, BASE);
    expect(readOverlay).toHaveBeenCalledWith(fs, BASE, "local");
    expect(readOverlay).toHaveBeenCalledWith(fs, BASE, "vps");
  });

  it("names no overlay when no environment declares the flag, and still rewrites the manifest", async () => {
    vi.mocked(readOverlay).mockResolvedValue(
      overlayOf("local", { "acme-dns01": true }),
    );
    const edits = await retireEdits(fs, BASE, FLAG, MANIFEST_TEXT);
    expect(edits.overlays).toEqual([]);
    expect(withoutFlag).not.toHaveBeenCalled();
    expect(edits.manifest.text).toBe("MANIFEST WITHOUT");
  });
});
