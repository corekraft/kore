// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md
import { describe, expect, it } from "vitest";
import { FlagError } from "./overlay.js";
import { parseManifest, readManifest, readManifestText } from "./manifest.js";
import { errno, fakeFileSystem } from "./flag-support.js";

const ROOT = "/repo";
const MANIFEST = `${ROOT}/infra/catalog/flags.yaml`;

/** A manifest as the repository writes it: JSON-compatible YAML, one entry per flag. */
const manifestText = (flags: unknown) => JSON.stringify({ flags }, null, 2);

describe("parseManifest reads each entry", () => {
  it("reads kind, applies and requires, with empty defaults for the marks an entry does not set", () => {
    const text = manifestText([
      {
        name: "in-cluster-ca",
        kind: "environment",
        applies: ["vps"],
        neverRetire: true,
      },
      { name: "platform-argocd-delivery", kind: "feature", applies: ["vps"] },
      {
        name: "service-listener-sets",
        kind: "feature",
        applies: ["vps"],
        requires: ["platform-shared-gateway"],
      },
    ]);
    expect(parseManifest(text)).toEqual([
      {
        name: "in-cluster-ca",
        kind: "environment",
        applies: ["vps"],
        requires: [],
        pending: false,
        notApplicable: [],
      },
      {
        name: "platform-argocd-delivery",
        kind: "feature",
        applies: ["vps"],
        requires: [],
        pending: false,
        notApplicable: [],
      },
      {
        name: "service-listener-sets",
        kind: "feature",
        applies: ["vps"],
        requires: ["platform-shared-gateway"],
        pending: false,
        notApplicable: [],
      },
    ]);
  });
});

describe("parseManifest reads the marks an entry sets", () => {
  it("reads the pending mark, the not-applicable environments and the reason, as the manifest states them", () => {
    const text = manifestText([
      {
        name: "otlp-route",
        kind: "feature",
        applies: ["local", "vps"],
        notApplicable: ["vps"],
        reason: "pods send OTLP to the in-cluster collector.",
      },
      {
        name: "registry-by-name",
        kind: "feature",
        applies: ["vps"],
        pending: true,
      },
    ]);
    expect(parseManifest(text)).toEqual([
      {
        name: "otlp-route",
        kind: "feature",
        applies: ["local", "vps"],
        requires: [],
        pending: false,
        notApplicable: ["vps"],
        reason: "pods send OTLP to the in-cluster collector.",
      },
      {
        name: "registry-by-name",
        kind: "feature",
        applies: ["vps"],
        requires: [],
        pending: true,
        notApplicable: [],
      },
    ]);
  });
});

describe("parseManifest refuses a manifest it cannot read", () => {
  it("refuses text that is not JSON-compatible YAML, naming the manifest", () => {
    expect(() => parseManifest("{ flags: [")).toThrow(
      new FlagError(
        "infra/catalog/flags.yaml is not JSON-compatible YAML, so the progress report cannot read it. Fix the syntax, then rerun.",
      ),
    );
  });

  it("refuses a manifest with no flags list", () => {
    expect(() => parseManifest(JSON.stringify({ other: [] }))).toThrow(
      new FlagError(
        "infra/catalog/flags.yaml must declare a flags list. Fix it, then rerun.",
      ),
    );
  });

  it("refuses an entry with no name, or a kind or applies it cannot have, so a broken entry never reads as a flag", () => {
    const message =
      "infra/catalog/flags.yaml has an entry that does not name a flag, declare a kind of feature, environment or harness, and list the environments it applies to. Fix it, then rerun.";
    expect(() =>
      parseManifest(manifestText([{ kind: "feature", applies: ["vps"] }])),
    ).toThrow(new FlagError(message));
    expect(() =>
      parseManifest(
        manifestText([{ name: "a-flag", kind: "tenancy", applies: ["vps"] }]),
      ),
    ).toThrow(new FlagError(message));
  });

  it("refuses a requires that is not a list of flag names", () => {
    const text = manifestText([
      {
        name: "a-flag",
        kind: "feature",
        applies: ["vps"],
        requires: "platform-shared-gateway",
      },
    ]);
    expect(() => parseManifest(text)).toThrow(
      new FlagError(
        "infra/catalog/flags.yaml requires of a-flag must be a list of flag names. Fix it, then rerun.",
      ),
    );
  });
});

describe("readManifestText", () => {
  it("returns the manifest's text as the repository holds it, unparsed", async () => {
    const text = manifestText([
      { name: "x", kind: "feature", applies: ["vps"] },
    ]);
    const fs = fakeFileSystem({ [MANIFEST]: text });
    expect(await readManifestText(fs, ROOT)).toBe(text);
  });

  it("refuses a manifest that cannot be read, naming the file and the cause", async () => {
    const fs = fakeFileSystem(
      {},
      { readFile: () => Promise.reject(errno("ENOENT")) },
    );
    await expect(readManifestText(fs, ROOT)).rejects.toEqual(
      new FlagError(
        "Cannot read infra/catalog/flags.yaml (ENOENT); the progress report reads the flag entries there. Restore the manifest, then rerun.",
      ),
    );
  });
});

describe("readManifest", () => {
  it("reads the manifest at the repository root and parses its entries", async () => {
    const fs = fakeFileSystem({
      [MANIFEST]: manifestText([
        { name: "platform-portal", kind: "feature", applies: ["vps"] },
      ]),
    });
    expect(await readManifest(fs, ROOT)).toEqual([
      {
        name: "platform-portal",
        kind: "feature",
        applies: ["vps"],
        requires: [],
        pending: false,
        notApplicable: [],
      },
    ]);
  });

  it("refuses a manifest that cannot be read, naming the file and the cause", async () => {
    const fs = fakeFileSystem(
      {},
      { readFile: () => Promise.reject(errno("ENOENT")) },
    );
    await expect(readManifest(fs, ROOT)).rejects.toEqual(
      new FlagError(
        "Cannot read infra/catalog/flags.yaml (ENOENT); the progress report reads the flag entries there. Restore the manifest, then rerun.",
      ),
    );
  });
});
