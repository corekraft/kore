import { expect, test } from "vitest";
import { backupJobPolicy } from "./backup-policy.js";

test("the job's policy allows one action, creating objects under its environment's prefix", () => {
  expect(backupJobPolicy("backups", "vps").Statement[0]).toEqual({
    Sid: "WriteBackupsOnly",
    Effect: "Allow",
    Action: ["s3:PutObject"],
    Resource: ["arn:aws:s3:::backups/vps/*"],
  });
});

test("the job's policy explicitly denies every delete, retention and legal-hold right on its objects", () => {
  expect(backupJobPolicy("backups", "vps").Statement[1]).toEqual({
    Sid: "NoDeleteNoRetentionChange",
    Effect: "Deny",
    Action: [
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:BypassGovernanceRetention",
      "s3:PutObjectRetention",
      "s3:PutObjectLegalHold",
    ],
    Resource: ["arn:aws:s3:::backups/vps/*"],
  });
});

test("no statement grants a wildcard, a list, or a read, so the job cannot see or remove what it wrote", () => {
  const granted = backupJobPolicy("backups", "vps")
    .Statement.filter((statement) => statement.Effect === "Allow")
    .flatMap((statement) => statement.Action);
  expect(granted).toEqual(["s3:PutObject"]);
  expect(granted.join(" ")).not.toMatch(/\*|Delete|Get|List|Bypass/);
});
