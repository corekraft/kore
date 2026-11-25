// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md
import { expect, test } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import { databaseRoleSplitArgs } from "./database-role-split-args.js";

const environment = (features: Record<string, boolean>) =>
  fakeEnvironment({
    platform: { domain: "kore.internal", organizationId: "platform" },
    gateway: { namespace: "kore-system", name: "kore-gateway", port: 8443 },
    features,
  });

test("the PostgreSQL API and its RBAC are handed the role-split value only while database-role-split is on", () => {
  const on = environment({ "database-role-split": true });
  expect(databaseRoleSplitArgs(on, "kore-postgresql-api")).toEqual([
    "--set",
    "databaseRoleSplit=true",
  ]);
  expect(databaseRoleSplitArgs(on, "kore-postgresql-rbac")).toEqual([
    "--set",
    "databaseRoleSplit=true",
  ]);
});

test("no value is passed while the flag is off or absent", () => {
  expect(
    databaseRoleSplitArgs(
      environment({ "database-role-split": false }),
      "kore-postgresql-api",
    ),
  ).toEqual([]);
  expect(databaseRoleSplitArgs(environment({}), "kore-postgresql-api")).toEqual(
    [],
  );
});

test("no other component takes the value", () => {
  expect(
    databaseRoleSplitArgs(
      environment({ "database-role-split": true }),
      "kore-platform-config",
    ),
  ).toEqual([]);
});
