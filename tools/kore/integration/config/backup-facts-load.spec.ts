// The gate facts read from real spec files (ADR 0155): loadBackupFacts over a services
// directory on disk, through the has-data rule, as loadRepository reads them while
// database-backups is on. The unit spec mocks the reading and the rule; this spec runs
// them together over temporary repositories.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { loadBackupFacts } from "../../src/testing/index.js";

type Environment = Parameters<typeof loadBackupFacts>[1];

const made: string[] = [];

afterEach(async () => {
  for (const dir of made.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** A Service spec file for the vps environment, with the spec fields a test sets. */
function service(spec: Record<string, unknown>): string {
  return JSON.stringify({
    apiVersion: "platform.kore.dev/v1alpha1",
    kind: "Service",
    metadata: { name: "leads" },
    spec: {
      organization: "platform",
      environments: ["vps"],
      components: { frontend: {} },
      ...spec,
    },
  });
}

/** A fresh repository root, with the given files in its vps services directory when any are given. */
async function repository(files?: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kore-backup-facts-"));
  made.push(root);
  if (files !== undefined) {
    const services = join(root, "infra/environments/vps/services");
    await mkdir(services, { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      await writeFile(join(services, name), text);
    }
  }
  return root;
}

/** The vps overlay with database-backups set as given and a backup target of the given kind, when any. */
function environment(on: boolean, kind?: "interim" | "off-host"): Environment {
  return {
    name: "vps",
    features: { "database-backups": on },
    ...(kind === undefined ? {} : { backup: { target: { kind } } }),
  } as unknown as Environment;
}

test("the facts name each service's has-data answer from its own spec file, in the overlay's target kind, skipping release files and dot files", async () => {
  const root = await repository({
    "leads.json": service({ databases: [{ name: "leads-db" }] }),
    "shop.json": service({ databases: [], secrets: [] }),
    "leads.release.json": "{}",
    ".keep": "",
  });
  expect(await loadBackupFacts(root, environment(true, "interim"))).toEqual({
    targetKind: "interim",
    services: { leads: { hasData: true }, shop: { hasData: false } },
  });
});

test("a service that declares a secret name has data, even with no database", async () => {
  const root = await repository({
    "api.json": service({ secrets: ["leads-api-key"] }),
  });
  expect(await loadBackupFacts(root, environment(true, "off-host"))).toEqual({
    targetKind: "off-host",
    services: { api: { hasData: true } },
  });
});

test("a spec file that is not JSON, or whose spec is not an object, is published as having data, so the gate fails closed", async () => {
  const root = await repository({
    "broken.json": "{ not json",
    "odd.json": JSON.stringify({ spec: "oops" }),
  });
  expect(await loadBackupFacts(root, environment(true, "interim"))).toEqual({
    targetKind: "interim",
    services: { broken: { hasData: true }, odd: { hasData: true } },
  });
});

test("a missing services directory is an environment with no services, not an error", async () => {
  const root = await repository();
  expect(await loadBackupFacts(root, environment(true, "interim"))).toEqual({
    targetKind: "interim",
    services: {},
  });
});

test("with database-backups off, or no backup target declared, no facts are loaded", async () => {
  const root = await repository();
  expect(await loadBackupFacts(root, environment(false, "interim"))).toBe(
    undefined,
  );
  expect(await loadBackupFacts(root, environment(true))).toBe(undefined);
});
