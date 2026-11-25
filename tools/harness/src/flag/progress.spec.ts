// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md
import { describe, expect, it } from "vitest";
import type { Proof } from "./proof.js";
import type { FlagKind, ManifestEntry } from "./manifest.js";
import { progressOf, type ProgressInput } from "./progress.js";

const PATH = "infra/environments/vps/environment.yaml";

const entry = (
  name: string,
  kind: FlagKind,
  applies: string[],
  extra: Partial<ManifestEntry> = {},
): ManifestEntry => ({
  name,
  kind,
  applies,
  requires: [],
  pending: false,
  notApplicable: [],
  ...extra,
});

/** A small manifest that covers each way a flag can be in or out of a report. */
const MANIFEST: ManifestEntry[] = [
  entry("in-cluster-ca", "environment", ["vps"]),
  entry("k3s-registry-trust", "environment", ["vps"]),
  entry("platform-shared-gateway", "feature", ["local", "vps"]),
  entry("service-listener-sets", "feature", ["vps"], {
    requires: ["platform-shared-gateway"],
  }),
  entry("database-routes", "feature", ["vps"], {
    notApplicable: ["vps"],
    reason: "v1 keeps the 5432 passthrough off the vps Gateways (ADR 0160)",
  }),
  entry("registry-by-name", "feature", ["vps"], {
    pending: true,
    notApplicable: ["vps"],
    reason: "vps serves the registry as an in-cluster ClusterIP (ADR 0143)",
  }),
  entry("naming-pending", "feature", ["vps"], { pending: true }),
  entry("platform-portal", "feature", ["vps"]),
  entry("automatic-retro", "harness", ["local"]),
];

const LIVE_RUN: Proof = {
  idea: "0001",
  path: "docs/ideas/0001-proof.md",
  source: "live-run",
};

const WAIVER: Proof = {
  idea: "0002",
  path: "docs/ideas/0002-proof.md",
  source: "owner-waiver",
};

const input = (overrides: Partial<ProgressInput> = {}): ProgressInput => ({
  environment: "vps",
  path: PATH,
  production: true,
  manifest: MANIFEST,
  features: {},
  proofs: new Map(),
  ...overrides,
});

describe("progressOf splits the flags that apply", () => {
  it("lists environment flags apart from feature flags, each with its on state and what it waits on", () => {
    const report = progressOf(
      input({
        features: {
          "in-cluster-ca": true,
          "platform-shared-gateway": true,
          "service-listener-sets": false,
        },
      }),
    );
    expect(report.environmentFlags).toEqual([
      {
        flag: "in-cluster-ca",
        kind: "environment",
        on: true,
        proof: "none",
        waitsOn: [],
      },
      {
        flag: "k3s-registry-trust",
        kind: "environment",
        on: false,
        proof: "none",
        waitsOn: [],
      },
    ]);
    expect(report.features.map((row) => row.flag)).toEqual([
      "platform-shared-gateway",
      "service-listener-sets",
      "platform-portal",
    ]);
  });

  it("reads a flag the overlay leaves out as off", () => {
    const report = progressOf(input({ features: {} }));
    expect(report.features[0]).toEqual({
      flag: "platform-shared-gateway",
      kind: "feature",
      on: false,
      proof: "none",
      waitsOn: [],
    });
  });

  it("names the live run or the owner waiver each flag rests on, and none when it has neither", () => {
    const report = progressOf(
      input({
        proofs: new Map([
          ["platform-shared-gateway", LIVE_RUN],
          ["platform-portal", WAIVER],
        ]),
      }),
    );
    expect(report.features.map((row) => row.proof)).toEqual([
      "live-run",
      "none",
      "owner-waiver",
    ]);
  });

  it("lists only the requirements that are off as what a flag still waits on", () => {
    const off = progressOf(
      input({ features: { "platform-shared-gateway": false } }),
    );
    const on = progressOf(
      input({ features: { "platform-shared-gateway": true } }),
    );
    expect(off.features[1]?.waitsOn).toEqual(["platform-shared-gateway"]);
    expect(on.features[1]?.waitsOn).toEqual([]);
  });
});

describe("progressOf counts every applicable feature flag", () => {
  it("is true when every applicable feature flag is on, whatever the environment flags are", () => {
    const report = progressOf(
      input({
        features: {
          "platform-shared-gateway": true,
          "service-listener-sets": true,
          "platform-portal": true,
        },
      }),
    );
    expect(report.everyApplicableFlagOn).toBe(true);
  });

  it("is false while one applicable feature flag is off", () => {
    const report = progressOf(
      input({
        features: {
          "platform-shared-gateway": true,
          "service-listener-sets": true,
          "platform-portal": false,
        },
      }),
    );
    expect(report.everyApplicableFlagOn).toBe(false);
  });

  it("is false when no feature flag applies, so an empty report never reads as all on", () => {
    const report = progressOf(
      input({
        manifest: [entry("in-cluster-ca", "environment", ["vps"])],
        features: { "in-cluster-ca": true },
      }),
    );
    expect(report.everyApplicableFlagOn).toBe(false);
  });
});

describe("progressOf excludes what does not apply, with the reason", () => {
  it("lists a not-applicable flag with its manifest reason, a pending flag with its reason, and never counts either", () => {
    const report = progressOf(input());
    expect(report.excluded).toEqual([
      {
        flag: "database-routes",
        status: "not applicable",
        reason: "v1 keeps the 5432 passthrough off the vps Gateways (ADR 0160)",
      },
      {
        flag: "registry-by-name",
        status: "not applicable",
        reason: "vps serves the registry as an in-cluster ClusterIP (ADR 0143)",
      },
      {
        flag: "naming-pending",
        status: "pending",
        reason: "its naming decision has not landed (ADR 0148)",
      },
    ]);
    expect(report.features.map((row) => row.flag)).not.toContain(
      "database-routes",
    );
  });

  it("lists a harness flag as excluded on local, where only the harness reads it", () => {
    const report = progressOf(
      input({
        environment: "local",
        path: "infra/environments/local/environment.yaml",
      }),
    );
    expect(report.excluded).toContainEqual({
      flag: "automatic-retro",
      status: "harness",
      reason: "only the local harness reads a harness flag (ADR 0148)",
    });
  });
});

describe("progressOf names the next flag to prove", () => {
  it("names the first environment flag with no live run, the way prerequisite order runs", () => {
    expect(progressOf(input()).next).toEqual({
      flag: "in-cluster-ca",
      kind: "environment",
    });
  });

  it("names the next flag once the ones before it have a live run, environment flags first", () => {
    const report = progressOf(
      input({
        proofs: new Map([
          ["in-cluster-ca", LIVE_RUN],
          ["k3s-registry-trust", LIVE_RUN],
        ]),
      }),
    );
    expect(report.next).toEqual({
      flag: "platform-shared-gateway",
      kind: "feature",
    });
  });

  it("names a flag that is on without a live run as still to prove", () => {
    const report = progressOf(input({ features: { "in-cluster-ca": true } }));
    expect(report.next).toEqual({ flag: "in-cluster-ca", kind: "environment" });
  });

  it("does not name a flag with a live run as next, even when the overlay has it off", () => {
    const report = progressOf(
      input({ proofs: new Map([["in-cluster-ca", LIVE_RUN]]) }),
    );
    expect(report.next).toEqual({
      flag: "k3s-registry-trust",
      kind: "environment",
    });
  });

  it("passes over a flag waiting on an off requirement, and names the next one whose requirements are on", () => {
    const report = progressOf(
      input({
        proofs: new Map([
          ["in-cluster-ca", LIVE_RUN],
          ["k3s-registry-trust", LIVE_RUN],
          ["platform-shared-gateway", LIVE_RUN],
        ]),
        features: { "platform-shared-gateway": false },
      }),
    );
    expect(report.next).toEqual({ flag: "platform-portal", kind: "feature" });
  });

  it("names no flag next when every flag still to prove waits on a requirement that is off", () => {
    const report = progressOf(
      input({
        proofs: new Map([
          ["in-cluster-ca", LIVE_RUN],
          ["k3s-registry-trust", LIVE_RUN],
          ["platform-shared-gateway", LIVE_RUN],
          ["platform-portal", LIVE_RUN],
        ]),
        features: { "platform-shared-gateway": false },
      }),
    );
    expect(report.next).toBeNull();
  });
});
