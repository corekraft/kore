// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md
import { describe, expect, it } from "vitest";
import { FlagError, type Overlay } from "./overlay.js";
import { assertMayTurnOn, flagRequires } from "./requirements.js";
import { errno, fakeFileSystem } from "./flag-support.js";

const ROOT = "/repo";
const MANIFEST = `${ROOT}/infra/catalog/flags.yaml`;

/** A manifest as the repository writes it: JSON-compatible YAML, one entry per flag. */
const manifest = (flags: unknown) => JSON.stringify({ flags }, null, 2);

/** A local overlay with the given features. */
const overlayWith = (features: Record<string, boolean>): Overlay => ({
  environment: "local",
  path: "infra/environments/local/environment.yaml",
  text: "",
  features,
});

describe("assertMayTurnOn", () => {
  it("passes when the overlay declares the flag and every flag it requires is on", () => {
    expect(() =>
      assertMayTurnOn(overlayWith({ a: false, b: true }), "a", ["b"]),
    ).not.toThrow();
  });

  it("refuses a flag the overlay does not declare, listing the declared ones", () => {
    expect(() =>
      assertMayTurnOn(overlayWith({ other: false }), "a", []),
    ).toThrow(
      'infra/environments/local/environment.yaml does not declare flag "a". Declared: other. Declare it as false first.',
    );
  });

  it("refuses a required flag that is off, and one the overlay leaves out, naming each", () => {
    expect(() =>
      assertMayTurnOn(overlayWith({ a: false, b: false }), "a", ["b", "c"]),
    ).toThrow(
      "a requires b, c on in local, but they are off in infra/environments/local/environment.yaml, so infra/environments/local/environment.yaml is unchanged. Activate b, c in local first with `harness flag activate`, then rerun.",
    );
  });
});

describe("flagRequires", () => {
  it("reads back the flags the named flag's manifest entry requires", async () => {
    const fs = fakeFileSystem({
      [MANIFEST]: manifest([
        {
          name: "registry-by-name",
          kind: "feature",
          applies: ["local"],
          requires: ["platform-shared-gateway"],
        },
        {
          name: "platform-shared-gateway",
          kind: "feature",
          applies: ["local"],
        },
      ]),
    });
    expect(await flagRequires(fs, ROOT, "registry-by-name")).toEqual([
      "platform-shared-gateway",
    ]);
  });

  it("requires nothing for a flag whose entry names no requires, or a flag the manifest does not declare", async () => {
    const fs = fakeFileSystem({
      [MANIFEST]: manifest([
        { name: "autoscaling-defaults", kind: "feature", applies: ["local"] },
      ]),
    });
    expect(await flagRequires(fs, ROOT, "autoscaling-defaults")).toEqual([]);
    expect(await flagRequires(fs, ROOT, "not-declared")).toEqual([]);
  });

  it("refuses a manifest that is missing, naming the file so the caller can restore it", async () => {
    const fs = fakeFileSystem(
      {},
      {
        readFile: () => Promise.reject(errno("ENOENT", "ENOENT: no such file")),
      },
    );
    const failure = flagRequires(fs, ROOT, "registry-by-name");
    await expect(failure).rejects.toBeInstanceOf(FlagError);
    await expect(failure).rejects.toThrow(
      "Cannot read infra/catalog/flags.yaml (ENOENT: no such file); flag activation reads the requirements there. Restore the manifest, then rerun.",
    );
  });
});

describe("flagRequires refusals", () => {
  it("refuses a manifest that is not JSON, naming the file", async () => {
    const fs = fakeFileSystem({ [MANIFEST]: "flags: [" });
    await expect(flagRequires(fs, ROOT, "registry-by-name")).rejects.toThrow(
      "infra/catalog/flags.yaml is not JSON-compatible YAML, so the requirements of a flag cannot be read. Fix the syntax, then rerun.",
    );
  });

  it("refuses a manifest with no flags list, so a broken manifest never reads as requiring nothing", async () => {
    const fs = fakeFileSystem({ [MANIFEST]: JSON.stringify({ other: 1 }) });
    await expect(flagRequires(fs, ROOT, "registry-by-name")).rejects.toThrow(
      "infra/catalog/flags.yaml must declare a flags list. Fix it, then rerun.",
    );
  });

  it("refuses a requires that is not a list of flag names, naming the flag", async () => {
    const fs = fakeFileSystem({
      [MANIFEST]: manifest([
        {
          name: "registry-by-name",
          kind: "feature",
          applies: ["local"],
          requires: "platform-shared-gateway",
        },
      ]),
    });
    await expect(flagRequires(fs, ROOT, "registry-by-name")).rejects.toThrow(
      "infra/catalog/flags.yaml requires of registry-by-name must be a list of flag names. Fix it, then rerun.",
    );
  });
});
