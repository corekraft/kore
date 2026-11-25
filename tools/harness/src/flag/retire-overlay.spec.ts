// Docs: docs/decisions/0149-a-feature-flag-retires-after-it-soaks-on-in-every-environment-it-applies-to.md
import { describe, expect, it } from "vitest";
import { FlagError, type Overlay } from "./overlay.js";
import { withoutFlag } from "./retire-overlay.js";

const PATH = "infra/environments/local/environment.yaml";

/** A local overlay as prettier writes it, with the features map the given text lays out. */
function overlayOf(features: string): Overlay {
  const text = `{\n  "name": "local",\n  "features": {\n${features}\n  },\n  "imageInventory": "audit"\n}\n`;
  return {
    environment: "local",
    path: PATH,
    text,
    features: {},
    production: false,
  };
}

describe("withoutFlag", () => {
  it("removes an entry that is on, and keeps the other features and every other key", () => {
    const overlay = overlayOf(
      '    "suborg-tenancy": true,\n    "platform-sync-window": false,\n    "acme-dns01": true',
    );
    const result = withoutFlag(overlay, "platform-sync-window");
    expect(JSON.parse(result)).toEqual({
      name: "local",
      features: { "suborg-tenancy": true, "acme-dns01": true },
      imageInventory: "audit",
    });
  });

  it("removes an entry that is off, the same as one that is on", () => {
    const overlay = overlayOf(
      '    "suborg-tenancy": false,\n    "acme-dns01": true',
    );
    const result = withoutFlag(overlay, "suborg-tenancy");
    expect(JSON.parse(result)).toMatchObject({
      features: { "acme-dns01": true },
    });
    expect(result).not.toContain("suborg-tenancy");
  });

  it("removes the last entry of the features map and leaves the map valid", () => {
    const overlay = overlayOf('    "acme-dns01": true');
    expect(JSON.parse(withoutFlag(overlay, "acme-dns01"))).toMatchObject({
      features: {},
    });
  });

  it("does not remove a flag whose name only starts another's", () => {
    const overlay = overlayOf(
      '    "suborg": true,\n    "suborg-tenancy": true',
    );
    expect(JSON.parse(withoutFlag(overlay, "suborg"))).toMatchObject({
      features: { "suborg-tenancy": true },
    });
  });

  it("refuses a flag the overlay does not declare, naming the overlay", () => {
    const overlay = overlayOf('    "acme-dns01": true');
    expect(() => withoutFlag(overlay, "suborg-tenancy")).toThrow(FlagError);
    expect(() => withoutFlag(overlay, "suborg-tenancy")).toThrow(
      `${PATH} does not declare suborg-tenancy in its features map`,
    );
  });
});
