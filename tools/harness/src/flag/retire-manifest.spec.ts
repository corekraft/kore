// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md
import { describe, expect, it } from "vitest";
import { FlagError } from "./overlay.js";
import { withoutManifestEntry } from "./retire-manifest.js";

const MANIFEST = `{
  "$schema": "./schemas/flags.schema.json",
  "retireSoakDays": 14,
  "flags":
    [
      {
        "name": "agentgateway-mesh-enrollment",
        "kind": "feature",
        "applies": ["local", "vps"]
      },
      {
        "name": "suborg-tenancy",
        "kind": "feature",
        "applies": ["local", "vps"],
        "requires":
          [
            "platform-organization-service-apis"
          ]
      },
      { "name": "acme-dns01", "kind": "feature", "applies": ["vps"] }
    ]
}
`;

describe("withoutManifestEntry", () => {
  it("removes the named entry and keeps every other entry and key", () => {
    const result = withoutManifestEntry(MANIFEST, "suborg-tenancy");
    const parsed = JSON.parse(result) as {
      retireSoakDays: number;
      flags: { name: string }[];
    };
    expect(parsed.flags.map((entry) => entry.name)).toEqual([
      "agentgateway-mesh-enrollment",
      "acme-dns01",
    ]);
    expect(parsed.retireSoakDays).toBe(14);
  });

  it("removes an entry written on one line, the last one in the list", () => {
    const result = withoutManifestEntry(MANIFEST, "acme-dns01");
    expect(JSON.parse(result)).toMatchObject({
      flags: [
        { name: "agentgateway-mesh-enrollment" },
        { name: "suborg-tenancy" },
      ],
    });
    expect(result).not.toContain("acme-dns01");
  });

  it("refuses a flag the manifest does not declare, naming the manifest", () => {
    expect(() => withoutManifestEntry(MANIFEST, "no-such-flag")).toThrow(
      FlagError,
    );
    expect(() => withoutManifestEntry(MANIFEST, "no-such-flag")).toThrow(
      /infra\/catalog\/flags\.yaml does not declare no-such-flag/,
    );
  });

  it("keeps the text byte for byte outside the removed entry", () => {
    const result = withoutManifestEntry(MANIFEST, "suborg-tenancy");
    expect(
      result.startsWith(
        '{\n  "$schema": "./schemas/flags.schema.json",\n  "retireSoakDays": 14,\n  "flags":\n    [\n',
      ),
    ).toBe(true);
    expect(result).toContain(
      '"name": "acme-dns01", "kind": "feature", "applies": ["vps"] }',
    );
  });
});
