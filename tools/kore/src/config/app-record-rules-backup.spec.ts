import { beforeEach, expect, test, vi } from "vitest";
import { specFileErrors } from "./app-record-rules.js";
import { databaseBackupErrors } from "./database-backup.js";
import { serviceNameErrors } from "./platform-claims.js";
import { schemaErrors, type SchemaNode } from "./schema-subset.js";

// The database backup rule is the unit under the wiring check here, so every
// collaborator of specFileErrors is mocked (ADR 0098); the rule's own tests are in
// database-backup.spec.ts. Factories default to no errors; beforeEach sets them again.
vi.mock("./database-backup.js", () => ({
  databaseBackupErrors: vi.fn(() => []),
}));
vi.mock("./platform-claims.js", () => ({ serviceNameErrors: vi.fn(() => []) }));
vi.mock("./schema-subset.js", () => ({ schemaErrors: vi.fn(() => []) }));

const file = "infra/environments/local/services/leads.json";
const stem = "leads";
const xrdSpec: SchemaNode = { type: "object" };
const manifest = {
  apiVersion: "platform.kore.dev/v1alpha1",
  kind: "Service",
  metadata: { name: "leads" },
  spec: { organization: "platform", components: { frontend: {} } },
};
const sentinel = `${file}: sentinel error from the database backup rule`;

beforeEach(() => {
  vi.mocked(databaseBackupErrors).mockReturnValue([]);
  vi.mocked(schemaErrors).mockReturnValue([]);
  vi.mocked(serviceNameErrors).mockReturnValue([]);
});

test("specFileErrors tells the database backup rule that the overlay declares a backup target", () => {
  specFileErrors({ file, stem, manifest, xrdSpec, backupTarget: true });
  expect(databaseBackupErrors).toHaveBeenCalledWith({
    file,
    manifest,
    backupTargetDeclared: true,
  });
});

test("specFileErrors tells the database backup rule that no backup target is declared when the overlay has none", () => {
  specFileErrors({ file, stem, manifest, xrdSpec, backupTarget: false });
  expect(databaseBackupErrors).toHaveBeenCalledWith({
    file,
    manifest,
    backupTargetDeclared: false,
  });
});

test("specFileErrors reads an unset backup target as none declared, so the rule refuses a backup opt-in", () => {
  specFileErrors({ file, stem, manifest, xrdSpec });
  expect(databaseBackupErrors).toHaveBeenCalledWith({
    file,
    manifest,
    backupTargetDeclared: false,
  });
});

test("the errors of the database backup rule reach the errors of the spec file", () => {
  vi.mocked(databaseBackupErrors).mockReturnValueOnce([sentinel]);
  expect(
    specFileErrors({ file, stem, manifest, xrdSpec, backupTarget: true }),
  ).toEqual([sentinel]);
});
