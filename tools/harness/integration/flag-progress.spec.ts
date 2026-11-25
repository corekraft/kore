// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md
import { describe, expect, it } from "vitest";
import { run } from "../src/cli/index.js";
import { harness, INDEX, MANIFEST, provenIdea } from "../src/testing/index.js";

const VPS = "infra/environments/vps/environment.yaml";
const REASON = "v1 keeps the 5432 passthrough off the vps Gateways (ADR 0160).";

/** The vps manifest: an environment flag, a feature flag, a feature that waits on it, and one not applicable to vps. */
const VPS_MANIFEST = JSON.stringify(
  {
    flags: [
      { name: "in-cluster-ca", kind: "environment", applies: ["vps"] },
      {
        name: "platform-shared-gateway",
        kind: "feature",
        applies: ["vps"],
      },
      {
        name: "service-listener-sets",
        kind: "feature",
        applies: ["vps"],
        requires: ["platform-shared-gateway"],
      },
      {
        name: "database-routes",
        kind: "feature",
        applies: ["vps"],
        notApplicable: ["vps"],
        reason: REASON,
      },
    ],
  },
  null,
  2,
);

/** The vps overlay, production, with the environment flag on and the feature flags off. */
const VPS_OVERLAY = JSON.stringify(
  {
    name: "vps",
    production: true,
    features: {
      "in-cluster-ca": true,
      "platform-shared-gateway": false,
      "service-listener-sets": false,
    },
  },
  null,
  2,
);

/** A repository with the vps overlay and manifest, a live run for the environment flag, and an owner waiver for a feature. */
function vpsRepository() {
  return harness({
    "docs/index.md": INDEX,
    [VPS]: VPS_OVERLAY,
    [MANIFEST]: VPS_MANIFEST,
    "docs/ideas/0001-live.md": provenIdea({
      Environment: "vps",
      Flag: "in-cluster-ca",
    }),
    "docs/ideas/0002-waiver.md": provenIdea({
      Environment: "vps",
      Flag: "platform-shared-gateway",
      Source: "owner-waiver",
    }),
  });
}

describe("harness flag progress reads the overlay, the manifest and the recorded proofs", () => {
  it("reports each flag's state and proof, refuses a waiver in production, and changes nothing", async () => {
    const h = vpsRepository();
    const before = h.snapshot();
    expect(
      await run(["flag", "progress", "--environment", "vps", "--json"], h.deps),
    ).toBe(0);
    expect(JSON.parse(h.out())).toEqual({
      environment: "vps",
      path: VPS,
      production: true,
      environmentFlags: [
        {
          flag: "in-cluster-ca",
          kind: "environment",
          on: true,
          proof: "live-run",
          waitsOn: [],
        },
      ],
      features: [
        {
          flag: "platform-shared-gateway",
          kind: "feature",
          on: false,
          proof: "none",
          waitsOn: [],
        },
        {
          flag: "service-listener-sets",
          kind: "feature",
          on: false,
          proof: "none",
          waitsOn: ["platform-shared-gateway"],
        },
      ],
      excluded: [
        { flag: "database-routes", status: "not applicable", reason: REASON },
      ],
      everyApplicableFlagOn: false,
      next: { flag: "platform-shared-gateway", kind: "feature" },
    });
    expect(h.snapshot()).toEqual(before);
  });

  it("prints the text report, naming the next flag to prove", async () => {
    const h = vpsRepository();
    expect(
      await run(["flag", "progress", "--environment", "vps"], h.deps),
    ).toBe(0);
    expect(h.out()).toContain(
      "Next flag to prove: platform-shared-gateway (feature flag).\n",
    );
    expect(h.out()).toContain("  in-cluster-ca: on, live run recorded\n");
    expect(h.out()).toContain(
      "  service-listener-sets: off, no live run, waits on platform-shared-gateway\n",
    );
  });
});
