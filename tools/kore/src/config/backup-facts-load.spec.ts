// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
import { beforeEach, expect, test, vi } from "vitest";

const fs = vi.hoisted(() => ({ readdir: vi.fn(), readFile: vi.fn() }));
vi.mock("node:fs/promises", () => fs);

import type { Environment } from "./types.js";
import { loadBackupFacts } from "./backup-facts-load.js";

const root = "/repo";
const leads = JSON.stringify({
  apiVersion: "platform.kore.dev/v1alpha1",
  kind: "Service",
  metadata: { name: "leads" },
  spec: {
    databases: [
      {
        name: "leads-db",
        version: 17,
        size: "10Gi",
        retentionPolicy: "Retain",
      },
    ],
  },
});

/** An overlay with the given backup flag and a declared target of the given kind. */
function environment(options: {
  on: boolean;
  kind?: "interim" | "off-host";
}): Environment {
  return {
    name: "vps",
    features: { "database-backups": options.on },
    ...(options.kind === undefined
      ? {}
      : { backup: { target: { kind: options.kind } } }),
  } as unknown as Environment;
}

beforeEach(() => {
  fs.readdir.mockReset();
  fs.readFile.mockReset();
});

test("with database-backups off nothing is read and no facts are published", async () => {
  const facts = await loadBackupFacts(
    root,
    environment({ on: false, kind: "interim" }),
  );
  expect(facts).toBeUndefined();
  expect(fs.readdir).not.toHaveBeenCalled();
});

test("with no backup target declared there is no kind to publish, so no facts", async () => {
  const facts = await loadBackupFacts(root, environment({ on: true }));
  expect(facts).toBeUndefined();
  expect(fs.readdir).not.toHaveBeenCalled();
});

test("the facts read the environment's spec files, skipping release files and dot files", async () => {
  fs.readdir.mockResolvedValue([
    "leads.json",
    "leads.release.json",
    ".keep",
    "shop.json",
  ]);
  fs.readFile.mockImplementation(async (path: string) =>
    path.endsWith("leads.json") ? leads : JSON.stringify({ spec: {} }),
  );
  const facts = await loadBackupFacts(
    root,
    environment({ on: true, kind: "off-host" }),
  );
  expect(fs.readdir).toHaveBeenCalledWith(
    "/repo/infra/environments/vps/services",
  );
  expect(fs.readFile.mock.calls.map((call) => call[0])).toEqual([
    "/repo/infra/environments/vps/services/leads.json",
    "/repo/infra/environments/vps/services/shop.json",
  ]);
  expect(facts).toEqual({
    targetKind: "off-host",
    services: { leads: { hasData: true }, shop: { hasData: false } },
  });
});

test("a spec file that is not JSON is published as having data, so the gate fails closed", async () => {
  fs.readdir.mockResolvedValue(["shop.json"]);
  fs.readFile.mockResolvedValue("{ not json");
  const facts = await loadBackupFacts(
    root,
    environment({ on: true, kind: "interim" }),
  );
  expect(facts?.services).toEqual({ shop: { hasData: true } });
});

test("an unreadable services directory is refused, naming the directory and the fix", async () => {
  fs.readdir.mockRejectedValue(
    Object.assign(new Error("denied"), { code: "EACCES" }),
  );
  await expect(
    loadBackupFacts(root, environment({ on: true, kind: "interim" })),
  ).rejects.toThrow(
    /\/repo\/infra\/environments\/vps\/services is unreadable.*restore read access/,
  );
});

test("an unreadable spec file is refused, naming the file and the fix", async () => {
  fs.readdir.mockResolvedValue(["shop.json"]);
  fs.readFile.mockRejectedValue(
    Object.assign(new Error("denied"), { code: "EACCES" }),
  );
  await expect(
    loadBackupFacts(root, environment({ on: true, kind: "interim" })),
  ).rejects.toThrow(
    /\/repo\/infra\/environments\/vps\/services\/shop\.json is unreadable.*restore read access/,
  );
});

test("a missing services directory is an environment with no services, not an error", async () => {
  fs.readdir.mockRejectedValue(
    Object.assign(new Error("gone"), { code: "ENOENT" }),
  );
  const facts = await loadBackupFacts(
    root,
    environment({ on: true, kind: "interim" }),
  );
  expect(facts).toEqual({ targetKind: "interim", services: {} });
});
