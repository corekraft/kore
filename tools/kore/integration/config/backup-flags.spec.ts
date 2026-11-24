import assert from "node:assert/strict";
import { test } from "vitest";
import {
  flagEntry,
  loadRepository,
  requiredFlags,
  validateRepository,
} from "../../src/config/index.js";
import type { Repository } from "../../src/config/index.js";

// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md

async function rejectionOf(repository: Repository): Promise<string> {
  try {
    await validateRepository(repository);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

test("a vps overlay declaring an off-host backup target on s3.example.com validates against the real .sops.yaml recipient", async () => {
  const base = await loadRepository("vps");
  assert.equal(base.sopsRecipients?.length, 1);
  await validateRepository({
    ...base,
    environment: {
      ...base.environment,
      backup: {
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
      },
    },
  });
});

test("the backup flags are declared as features, openbao-snapshots requires openbao and database-backups, and both are off in every overlay", async () => {
  const { flags } = await loadRepository("vps");
  assert.deepEqual(flagEntry(flags, "database-backups")?.kind, "feature");
  assert.deepEqual(requiredFlags(flags, "database-backups"), []);
  assert.deepEqual(flagEntry(flags, "openbao-snapshots")?.kind, "feature");
  assert.deepEqual(requiredFlags(flags, "openbao-snapshots"), [
    "openbao",
    "database-backups",
  ]);
  for (const name of ["local", "vps", "managed-example"]) {
    const repository = await loadRepository(name);
    for (const flag of ["database-backups", "openbao-snapshots"]) {
      assert.equal(
        repository.environment.features?.[flag],
        false,
        `${name} ${flag}`,
      );
    }
  }
});

test("a vps overlay with the backup flags on and no backup target is refused, naming each flag, its target and its prerequisite", async () => {
  const base = await loadRepository("vps");
  const message = await rejectionOf({
    ...base,
    environment: {
      ...base.environment,
      features: {
        ...base.environment.features,
        "database-backups": true,
        "openbao-snapshots": true,
      },
    },
  });
  assert.equal(
    message,
    [
      "flag database-backups is on in the vps overlay but backup.target is not declared; declare backup.target, or turn database-backups off (ADR 0155)",
      "flag openbao-snapshots is on in the vps overlay but backup.target is not declared; declare backup.target, or turn openbao-snapshots off (ADR 0155)",
      'flag openbao-snapshots is on in the vps overlay but requires openbao, which is off there; set "openbao": true in the vps overlay, or turn openbao-snapshots off (ADR 0148)',
    ].join("\n"),
  );
});
