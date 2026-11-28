// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md
import { expect, test } from "vitest";
import { fakeEnvironment, fakeRepository } from "./config-support.js";
import { flagManifestErrors } from "./flag-manifest.js";
import type { FlagManifest, Repository } from "./types.js";

/** A repository whose manifest is the given one; the overlay turns on no flags. */
function repositoryOf(flags: FlagManifest): Repository {
  return fakeRepository({
    environment: fakeEnvironment({ name: "local" }),
    flags,
  });
}

test("a requires edge binds where the required flag applies, so an edge both flags share has no error", () => {
  const manifest: FlagManifest = {
    flags: [
      {
        name: "platform-shared-gateway",
        kind: "feature",
        applies: ["local", "vps"],
      },
      {
        name: "service-listener-sets",
        kind: "feature",
        applies: ["local", "vps"],
        requires: ["platform-shared-gateway"],
      },
    ],
  };
  expect(flagManifestErrors(repositoryOf(manifest))).toEqual([]);
});

test("a requires edge whose required flag does not apply where the requiring flag applies is refused, naming both flags and the environment", () => {
  const manifest: FlagManifest = {
    flags: [
      {
        name: "platform-shared-gateway",
        kind: "feature",
        applies: ["local"],
      },
      {
        name: "service-listener-sets",
        kind: "feature",
        applies: ["local", "vps"],
        requires: ["platform-shared-gateway"],
      },
    ],
  };
  expect(flagManifestErrors(repositoryOf(manifest))).toEqual([
    "flag service-listener-sets requires platform-shared-gateway, which does not apply to vps, so the edge can never bind there; remove platform-shared-gateway from the requires of service-listener-sets, or mark service-listener-sets not applicable to vps with a reason (ADR 0148)",
  ]);
});

test("a requires edge to a required flag marked not applicable in an environment is refused there, with that reason", () => {
  const manifest: FlagManifest = {
    flags: [
      {
        name: "openbao",
        kind: "feature",
        applies: ["local", "vps"],
        notApplicable: ["vps"],
        reason: "OpenBao holds application secrets on vps only (ADR 0167).",
      },
      {
        name: "openbao-snapshots",
        kind: "feature",
        applies: ["local", "vps"],
        requires: ["openbao"],
      },
    ],
  };
  expect(flagManifestErrors(repositoryOf(manifest))).toEqual([
    "flag openbao-snapshots requires openbao, which is not applicable to vps (OpenBao holds application secrets on vps only (ADR 0167).), so the edge can never bind there; remove openbao from the requires of openbao-snapshots, or mark openbao-snapshots not applicable to vps with a reason (ADR 0148)",
  ]);
});

test("a dead edge is refused once for each environment it is dead in, in manifest order", () => {
  const manifest: FlagManifest = {
    flags: [
      { name: "local-only", kind: "feature", applies: ["local"] },
      {
        name: "wide",
        kind: "feature",
        applies: ["local", "vps", "managed-example"],
        requires: ["local-only"],
      },
    ],
  };
  const errors = flagManifestErrors(repositoryOf(manifest));
  expect(errors).toHaveLength(2);
  expect(errors[0]).toContain(
    "requires local-only, which does not apply to vps,",
  );
  expect(errors[1]).toContain(
    "requires local-only, which does not apply to managed-example,",
  );
});

test("an edge whose requiring flag is not applicable in an environment is not reported there, because it never binds there", () => {
  const manifest: FlagManifest = {
    flags: [
      { name: "local-only", kind: "feature", applies: ["local"] },
      {
        name: "wide",
        kind: "feature",
        applies: ["local", "vps"],
        notApplicable: ["vps"],
        reason: "wide is local only in v1.",
        requires: ["local-only"],
      },
    ],
  };
  expect(flagManifestErrors(repositoryOf(manifest))).toEqual([]);
});

test("a requires edge to a flag with no entry is left to the missing-entry check, not reported again as dead", () => {
  const manifest: FlagManifest = {
    flags: [
      {
        name: "needs-ghost",
        kind: "feature",
        applies: ["local", "vps"],
        requires: ["ghost"],
      },
    ],
  };
  expect(flagManifestErrors(repositoryOf(manifest))).toEqual([
    "flag needs-ghost requires ghost, which has no entry in infra/catalog/flags.yaml; declare ghost in the manifest or drop it from the requires of needs-ghost (ADR 0148)",
  ]);
});

test("the edge shapes the catalog uses today, a chain across environments and an edge both flags leave out of one environment, have no error", () => {
  const manifest: FlagManifest = {
    flags: [
      {
        name: "gateway",
        kind: "feature",
        applies: ["local", "vps", "managed-example"],
      },
      {
        name: "listeners",
        kind: "feature",
        applies: ["local", "vps", "managed-example"],
        requires: ["gateway"],
      },
      {
        name: "external",
        kind: "feature",
        applies: ["local", "vps", "managed-example"],
        requires: ["listeners"],
      },
      {
        name: "database-backups",
        kind: "feature",
        applies: ["local", "vps", "managed-example"],
        notApplicable: ["local", "managed-example"],
        reason: "The scheduled backup job is a vps job (ADR 0155).",
      },
      {
        name: "openbao",
        kind: "feature",
        applies: ["local", "vps", "managed-example"],
        notApplicable: ["local", "managed-example"],
        reason: "OpenBao holds application secrets on vps only (ADR 0167).",
      },
      {
        name: "openbao-snapshots",
        kind: "feature",
        applies: ["local", "vps", "managed-example"],
        requires: ["openbao", "database-backups"],
        notApplicable: ["local", "managed-example"],
        reason: "The OpenBao snapshot job is a vps job (ADR 0155).",
      },
    ],
  };
  expect(flagManifestErrors(repositoryOf(manifest))).toEqual([]);
});
