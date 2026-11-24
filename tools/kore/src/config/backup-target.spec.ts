// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
import { expect, test } from "vitest";
import { backupTargetErrors } from "./backup-target.js";
import {
  fakeEnvironment,
  fakeRepository,
  malformed,
} from "./config-support.js";
import type { BackupDeclaration, Repository } from "./types.js";

const RECIPIENT = `age1${"q".repeat(58)}`;
const PLACEHOLDER = "AGE-RECIPIENT-MUST-BE-CONFIGURED";

const declaration: BackupDeclaration = {
  target: {
    endpoint: "https://s3.example.com",
    bucket: "kore-backups",
    region: "us-east-1",
    pathStyle: false,
    credentials: { secret: "kore-backup-target" },
    kind: "off-host",
  },
  retention: { daily: 14 },
  schedule: "03:30",
};

/** The declaration with its target's fields replaced; a test passes the bad field it checks. */
function withTarget(fields: Record<string, unknown>): BackupDeclaration {
  return malformed<BackupDeclaration>({
    ...declaration,
    target: { ...declaration.target, ...fields },
  });
}

/**
 * The vps repository: its overlay declares the backup and turns the given flags
 * on, and .sops.yaml names the given recipients. `null` means .sops.yaml names none.
 */
function vpsRepository(
  backup: BackupDeclaration | undefined,
  features: Record<string, boolean> = {},
  recipients: string[] | null = [RECIPIENT],
): Repository {
  const environment = fakeEnvironment({
    name: "vps",
    provider: "managed",
    platform: { domain: "kore.internal", organizationId: "platform" },
    features,
    ...(backup === undefined ? {} : { backup }),
  });
  return fakeRepository({
    environment,
    sopsRecipients: recipients ?? undefined,
  });
}

test("a declared off-host target outside the box and its cluster, with its retention and schedule, reports nothing", () => {
  expect(backupTargetErrors(vpsRepository(declaration))).toEqual([]);
});

test("an overlay with no backup declaration and its backup flags off reports nothing, and reads no recipient", () => {
  expect(
    backupTargetErrors(
      vpsRepository(undefined, {
        "database-backups": false,
        "openbao-snapshots": false,
      }),
    ),
  ).toEqual([]);
  expect(backupTargetErrors(vpsRepository(undefined, {}, null))).toEqual([]);
});

test("an unknown field under backup.target is refused, and the message names the fields it may take", () => {
  expect(
    backupTargetErrors(vpsRepository(withTarget({ region2: "eu-west-1" }))),
  ).toEqual([
    "backup.target.region2 is not a field of this record; the fields here are endpoint, bucket, region, pathStyle, caBundle, credentials, kind",
  ]);
});

test("the kind is a closed choice of interim or off-host", () => {
  expect(
    backupTargetErrors(vpsRepository(withTarget({ kind: "local" }))),
  ).toEqual(["backup.target.kind must be one of interim, off-host"]);
});

test("the endpoint is an https origin, and a plain http one is refused by its pattern", () => {
  expect(
    backupTargetErrors(
      vpsRepository(withTarget({ endpoint: "http://s3.example.com" })),
    ),
  ).toEqual([
    "backup.target.endpoint must match ^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$",
  ]);
});

test("the retention is fixed at the newest 14 daily backups", () => {
  expect(
    backupTargetErrors(
      vpsRepository(
        malformed<BackupDeclaration>({
          ...declaration,
          retention: { daily: 7 },
        }),
      ),
    ),
  ).toEqual(["backup.retention.daily must be 14"]);
});

test("an off-host endpoint under a cluster-internal name is refused, and names the interim kind as the alternative", () => {
  expect(
    backupTargetErrors(
      vpsRepository(
        withTarget({ endpoint: "https://seaweedfs.svc.cluster.local" }),
      ),
    ),
  ).toEqual([
    "backup.target.endpoint seaweedfs.svc.cluster.local is a cluster-internal name, so an off-host target would live on the box; name an endpoint outside the box and its cluster, for example https://s3.example.com, or set backup.target.kind to interim (ADR 0155)",
  ]);
});

test("an off-host endpoint under the platform domain is refused, since the box serves that domain", () => {
  expect(
    backupTargetErrors(
      vpsRepository(withTarget({ endpoint: "https://backups.kore.internal" })),
    ),
  ).toEqual([
    "backup.target.endpoint backups.kore.internal is under the platform domain kore.internal, which the box serves, so an off-host target would live on the box; name an endpoint outside the box and its cluster, for example https://s3.example.com, or set backup.target.kind to interim (ADR 0155)",
  ]);
});

test("an off-host endpoint that is a private IP address of the box is refused", () => {
  expect(
    backupTargetErrors(
      vpsRepository(withTarget({ endpoint: "https://10.77.0.10" })),
    ),
  ).toEqual([
    "backup.target.endpoint 10.77.0.10 is an IP address; an off-host target needs a name outside the box, since the repository holds no address of the box to compare with: use the provider's endpoint name, for example https://s3.example.com, or set backup.target.kind to interim (ADR 0155)",
  ]);
});

test("an off-host endpoint that is a public IP address is refused too, since the box's public address is not in the repository", () => {
  expect(
    backupTargetErrors(
      vpsRepository(withTarget({ endpoint: "https://203.0.113.7" })),
    ),
  ).toEqual([
    "backup.target.endpoint 203.0.113.7 is an IP address; an off-host target needs a name outside the box, since the repository holds no address of the box to compare with: use the provider's endpoint name, for example https://s3.example.com, or set backup.target.kind to interim (ADR 0155)",
  ]);
});

test("an interim target may name a cluster-internal endpoint, since the interim target sits on the box", () => {
  expect(
    backupTargetErrors(
      vpsRepository(
        withTarget({
          kind: "interim",
          endpoint: "https://seaweedfs.svc.cluster.local",
        }),
      ),
    ),
  ).toEqual([]);
});

test("a backup flag on without a declared target is refused, naming each flag", () => {
  expect(
    backupTargetErrors(
      vpsRepository(undefined, {
        "database-backups": true,
        "openbao-snapshots": true,
      }),
    ),
  ).toEqual([
    "flag database-backups is on in the vps overlay but backup.target is not declared; declare backup.target, or turn database-backups off (ADR 0155)",
    "flag openbao-snapshots is on in the vps overlay but backup.target is not declared; declare backup.target, or turn openbao-snapshots off (ADR 0155)",
  ]);
});

test("a backup flag on with a declared target reports nothing for the flag", () => {
  expect(
    backupTargetErrors(
      vpsRepository(declaration, { "database-backups": true }),
    ),
  ).toEqual([]);
});

test("a declared target with no age recipient for the environment in .sops.yaml is refused, naming the file and the path", () => {
  const message =
    ".sops.yaml has no age recipient for environments/vps/ secrets, so backup.target cannot encrypt backups to it; add the public age recipient (age1...) to that creation rule (ADR 0155)";
  expect(backupTargetErrors(vpsRepository(declaration, {}, null))).toEqual([
    message,
  ]);
  expect(backupTargetErrors(vpsRepository(declaration, {}, []))).toEqual([
    message,
  ]);
});

test("a declared target whose .sops.yaml recipient is still the placeholder is refused, naming the placeholder", () => {
  expect(
    backupTargetErrors(vpsRepository(declaration, {}, [PLACEHOLDER])),
  ).toEqual([
    "the age recipient in .sops.yaml for vps is still the placeholder AGE-RECIPIENT-MUST-BE-CONFIGURED; set it to the public age recipient (age1...) you generated (ADR 0155)",
  ]);
});

test("a declared target whose .sops.yaml recipient is not an age key is refused, naming the entry", () => {
  expect(
    backupTargetErrors(vpsRepository(declaration, {}, ["age1short"])),
  ).toEqual([
    '"age1short" in .sops.yaml is not a valid age recipient for vps (expected age1 followed by 58 characters); set the public recipient printed by age-keygen',
  ]);
});
