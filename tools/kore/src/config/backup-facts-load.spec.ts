// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
import { beforeEach, expect, test, vi } from "vitest";

const fs = vi.hoisted(() => ({ readdir: vi.fn(), readFile: vi.fn() }));
vi.mock("node:fs/promises", () => fs);
const path = vi.hoisted(() => ({ join: vi.fn() }));
vi.mock("node:path", () => path);
// The facts builder is its own unit (backup-facts.spec.ts), so it is mocked here (ADR 0098).
vi.mock("./backup-facts.js", () => ({ backupFacts: vi.fn() }));

import { backupFacts } from "./backup-facts.js";
import { loadBackupFacts } from "./backup-facts-load.js";
import type { BackupFacts, Environment } from "./types.js";

const root = "/repo";
const services = "/repo/infra/environments/vps/services";
const leadsManifest = { spec: { databases: [{ name: "leads-db" }] } };
const leads = JSON.stringify(leadsManifest);
const facts: BackupFacts = { targetKind: "off-host", services: {} };

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
  path.join.mockReset();
  path.join.mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(backupFacts).mockReset();
  vi.mocked(backupFacts).mockReturnValue(facts);
});

test("with database-backups off nothing is read and no facts are built", async () => {
  const result = await loadBackupFacts(
    root,
    environment({ on: false, kind: "interim" }),
  );
  expect(result).toBeUndefined();
  expect(fs.readdir).not.toHaveBeenCalled();
  expect(backupFacts).not.toHaveBeenCalled();
});

test("with no backup target declared there is no kind to publish, so no facts are built", async () => {
  const result = await loadBackupFacts(root, environment({ on: true }));
  expect(result).toBeUndefined();
  expect(fs.readdir).not.toHaveBeenCalled();
  expect(backupFacts).not.toHaveBeenCalled();
});

test("the facts are built from the environment's spec files in name order, skipping release files and dot files, and the built facts are returned", async () => {
  fs.readdir.mockResolvedValue([
    "shop.json",
    "leads.json",
    "leads.release.json",
    ".keep",
  ]);
  fs.readFile.mockImplementation(async (file: string) =>
    file.endsWith("leads.json") ? leads : JSON.stringify({ spec: {} }),
  );
  const result = await loadBackupFacts(
    root,
    environment({ on: true, kind: "off-host" }),
  );
  expect(path.join).toHaveBeenCalledWith(
    root,
    "infra/environments",
    "vps",
    "services",
  );
  expect(fs.readdir).toHaveBeenCalledWith(services);
  expect(fs.readFile.mock.calls.map((call) => call[0])).toEqual([
    `${services}/leads.json`,
    `${services}/shop.json`,
  ]);
  expect(backupFacts).toHaveBeenCalledWith("off-host", [
    { name: "leads", manifest: leadsManifest },
    { name: "shop", manifest: { spec: {} } },
  ]);
  expect(result).toBe(facts);
});

test("a spec file that is not JSON is passed to the facts builder as no manifest, so its record is not read as having none", async () => {
  fs.readdir.mockResolvedValue(["shop.json"]);
  fs.readFile.mockResolvedValue("{ not json");
  const result = await loadBackupFacts(
    root,
    environment({ on: true, kind: "interim" }),
  );
  expect(backupFacts).toHaveBeenCalledWith("interim", [
    { name: "shop", manifest: undefined },
  ]);
  expect(result).toBe(facts);
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
  expect(backupFacts).not.toHaveBeenCalled();
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
  expect(backupFacts).not.toHaveBeenCalled();
});

test("a missing services directory is an environment with no records, built as such and returned, not an error", async () => {
  fs.readdir.mockRejectedValue(
    Object.assign(new Error("gone"), { code: "ENOENT" }),
  );
  const result = await loadBackupFacts(
    root,
    environment({ on: true, kind: "interim" }),
  );
  expect(backupFacts).toHaveBeenCalledWith("interim", []);
  expect(result).toBe(facts);
});
