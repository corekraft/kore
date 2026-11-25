// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md
import { describe, expect, it } from "vitest";
import type { ProgressReport } from "./progress.js";
import { renderProgress } from "./progress-text.js";

const PATH = "infra/environments/vps/environment.yaml";

const REPORT: ProgressReport = {
  environment: "vps",
  path: PATH,
  production: true,
  environmentFlags: [
    {
      flag: "in-cluster-ca",
      kind: "environment",
      on: true,
      proof: "live-run",
      waitsOn: [],
    },
    {
      flag: "k3s-registry-trust",
      kind: "environment",
      on: false,
      proof: "none",
      waitsOn: [],
    },
  ],
  features: [
    {
      flag: "platform-shared-gateway",
      kind: "feature",
      on: true,
      proof: "owner-waiver",
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
    {
      flag: "database-routes",
      status: "not applicable",
      reason: "v1 keeps the 5432 passthrough off the vps Gateways (ADR 0160)",
    },
    {
      flag: "naming-pending",
      status: "pending",
      reason: "its naming decision has not landed (ADR 0148)",
    },
  ],
  everyApplicableFlagOn: false,
  next: { flag: "k3s-registry-trust", kind: "environment" },
};

describe("renderProgress prints the report as text", () => {
  it("prints each section, the counts, and the next flag to prove, one line each", () => {
    expect(renderProgress(REPORT)).toBe(
      [
        "Flag progress for vps (infra/environments/vps/environment.yaml)",
        "Production: yes, so an owner waiver is not proof (ADR 0147).",
        "",
        "Environment flags (activated, not counted as features):",
        "  in-cluster-ca: on, live run recorded",
        "  k3s-registry-trust: off, no live run",
        "",
        "Feature flags:",
        "  platform-shared-gateway: on, owner waiver only, not a live run",
        "  service-listener-sets: off, no live run, waits on platform-shared-gateway",
        "",
        "Excluded:",
        "  database-routes: not applicable, v1 keeps the 5432 passthrough off the vps Gateways (ADR 0160)",
        "  naming-pending: pending, its naming decision has not landed (ADR 0148)",
        "",
        "Environment flags on: 1 of 2, with a live run: 1.",
        "Feature flags on: 1 of 2, with a live run: 0.",
        "Every applicable feature flag is on: no.",
        "Next flag to prove: k3s-registry-trust (environment flag).",
        "",
      ].join("\n"),
    );
  });

  it("says none for an empty section, and names no flag next when none is left to prove", () => {
    const text = renderProgress({
      ...REPORT,
      environmentFlags: [],
      excluded: [],
      next: null,
    });
    expect(text).toContain(
      "Environment flags (activated, not counted as features):\n  none.\n",
    );
    expect(text).toContain("Excluded:\n  none.\n");
    expect(text).toContain(
      "Next flag to prove: none; every flag still to prove waits on a flag that is off.\n",
    );
  });
});

describe("renderProgress names the next flag only when one is left", () => {
  it("says every applicable flag has a live run when none is left to prove, not that one waits", () => {
    const text = renderProgress({
      ...REPORT,
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
          flag: "service-listener-sets",
          kind: "feature",
          on: false,
          proof: "live-run",
          waitsOn: [],
        },
      ],
      everyApplicableFlagOn: false,
      next: null,
    });
    expect(text.split("\n").slice(-2)).toEqual([
      "Next flag to prove: none; every applicable flag has a live run.",
      "",
    ]);
  });
});
