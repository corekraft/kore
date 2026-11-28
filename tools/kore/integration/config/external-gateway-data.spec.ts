// The record-bump refusal of an external service with data (ADR 0155), over fixture
// repositories: the spec file is read and checked through checkAppRecords, as kore
// validate reads it, so the refusal is what a reviewer's record bump would see.
import { afterEach, expect, test } from "vitest";
import { dir, fixture, record, type Fixture } from "./app-records-support.js";

const made: Fixture[] = [];

async function repo(...args: Parameters<typeof fixture>): Promise<Fixture> {
  const created = await fixture(...args);
  made.push(created);
  return created;
}

afterEach(async () => {
  for (const created of made.splice(0)) {
    await created.remove();
  }
});

const database = [
  { name: "leads-db", version: 17, size: "10Gi", retentionPolicy: "Retain" },
];
const file = `${dir}/leads.json`;

test("an external service with data is refused while the target kind is interim, naming the service and the fix", async () => {
  const f = await repo({
    [file]: record("leads", { gateway: "external", databases: database }),
  });
  const report = await f.check({ backupKind: "interim" });
  expect(report.errors).toEqual([
    expect.stringContaining(
      `${file}: service leads sets gateway: external and has data`,
    ),
  ]);
  expect(report.errors[0]).toContain("set spec.gateway to internal");
});

test("the same external service is accepted once the target kind is off-host", async () => {
  const f = await repo({
    [file]: record("leads", { gateway: "external", databases: database }),
  });
  expect(await f.check({ backupKind: "off-host" })).toEqual({
    errors: [],
    warnings: [],
  });
});

test("an internal service with data is never refused, whatever the kind", async () => {
  const f = await repo({
    [file]: record("leads", { gateway: "internal", databases: database }),
  });
  expect(await f.check({ backupKind: "interim" })).toEqual({
    errors: [],
    warnings: [],
  });
});

test("an external service with no data is never refused while the kind is interim", async () => {
  const f = await repo({
    [file]: record("leads", { gateway: "external" }),
  });
  expect(await f.check({ backupKind: "interim" })).toEqual({
    errors: [],
    warnings: [],
  });
});

test("an external service with a declared secret name is refused while the kind is interim", async () => {
  const f = await repo({
    [file]: record("leads", {
      gateway: "external",
      secrets: ["leads-api-key"],
    }),
  });
  const report = await f.check({ backupKind: "interim" });
  expect(report.errors).toHaveLength(1);
});
