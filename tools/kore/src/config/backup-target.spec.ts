// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
import { beforeEach, expect, test, vi } from "vitest";
import { backupSchema, backupTargetErrors } from "./backup-target.js";
import {
  fakeEnvironment,
  fakeRepository,
  malformed,
} from "./config-support.js";
import { schemaErrors } from "./schema-subset.js";
import { isAgeRecipient } from "./sops-recipients.js";
import type { BackupDeclaration, Repository } from "./types.js";

vi.mock("./schema-subset.js", () => ({ schemaErrors: vi.fn() }));
vi.mock("./sops-recipients.js", async (importOriginal) => ({
  PLACEHOLDER_RECIPIENT: (
    await importOriginal<typeof import("./sops-recipients.js")>()
  ).PLACEHOLDER_RECIPIENT,
  isAgeRecipient: vi.fn(),
}));

const RECIPIENT = `age1${"q".repeat(58)}`;
const PLACEHOLDER = "AGE-RECIPIENT-MUST-BE-CONFIGURED";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(schemaErrors).mockReturnValue([]);
  vi.mocked(isAgeRecipient).mockReturnValue(true);
});

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

test("the declaration is checked against backupSchema under the name backup, and the schema errors it finds are reported", () => {
  vi.mocked(schemaErrors).mockReturnValueOnce(["backup.target.kind bad"]);
  expect(backupTargetErrors(vpsRepository(declaration))).toEqual([
    "backup.target.kind bad",
  ]);
  expect(schemaErrors).toHaveBeenCalledWith(
    backupSchema,
    declaration,
    "backup",
  );
});

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
  expect(isAgeRecipient).not.toHaveBeenCalled();
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
  vi.mocked(isAgeRecipient).mockReturnValueOnce(false);
  expect(
    backupTargetErrors(vpsRepository(declaration, {}, ["age1short"])),
  ).toEqual([
    '"age1short" in .sops.yaml is not a valid age recipient for vps (expected age1 followed by 58 characters); set the public recipient printed by age-keygen',
  ]);
});
