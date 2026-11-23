import { expect, test } from "vitest";
import { MANIFEST_SUFFIX } from "./export-manifest.js";
import { backupObject, backupStamp } from "./backup-layout.js";

const target = {
  environment: "vps",
  namespace: "golden-path",
  cluster: "pg-main",
  database: "app",
};

test("the stamp is the UTC creation time with no fraction and no colons, so it is a plain object name", () => {
  expect(backupStamp(new Date("2026-11-23T04:05:06.789Z"))).toBe(
    "2026-11-23T04-05-06Z",
  );
});

test("an object lives under one prefix per environment, namespace, cluster and database", () => {
  expect(backupObject(target, "2026-11-23T04-05-06Z").object).toBe(
    "vps/golden-path/pg-main/app/2026-11-23T04-05-06Z.sql.age",
  );
});

test("the artifact's file name is the object's last segment, which is what its manifest names", () => {
  expect(backupObject(target, "2026-11-23T04-05-06Z").file).toBe(
    "2026-11-23T04-05-06Z.sql.age",
  );
});

test("the manifest sits beside its object under the export manifest suffix", () => {
  const { object, manifest } = backupObject(target, "2026-11-23T04-05-06Z");
  expect(MANIFEST_SUFFIX).toBe(".manifest.json");
  expect(manifest).toBe(`${object}${MANIFEST_SUFFIX}`);
  expect(manifest).toBe(
    "vps/golden-path/pg-main/app/2026-11-23T04-05-06Z.sql.age.manifest.json",
  );
});

test("a name that could leave its prefix is refused, and the message names the field", () => {
  expect(() =>
    backupObject({ ...target, namespace: "../other" }, "2026-11-23T04-05-06Z"),
  ).toThrow(
    'invalid backup name "../other" for namespace: use lower-case letters, digits, "-" or "_", starting with a letter or digit',
  );
});

test("an empty name is refused rather than becoming an empty path segment", () => {
  expect(() =>
    backupObject({ ...target, database: "" }, "2026-11-23T04-05-06Z"),
  ).toThrow('invalid backup name "" for database');
});
