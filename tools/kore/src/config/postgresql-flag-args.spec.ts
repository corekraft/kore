// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md
import { expect, test } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import { postgresqlFlagArgs } from "./postgresql-flag-args.js";

const environment = (features: Record<string, boolean>) =>
  fakeEnvironment({
    platform: { domain: "kore.internal", organizationId: "platform" },
    gateway: { namespace: "kore-system", name: "kore-gateway", port: 8443 },
    features,
  });

test("the PostgreSQL API is handed both composition values while their flags are on", () => {
  expect(
    postgresqlFlagArgs(
      environment({
        "postgresql-service-class-instances": true,
        "database-role-split": true,
      }),
      "kore-postgresql-api",
    ),
  ).toEqual([
    "--set",
    "serviceClassInstances=true",
    "--set",
    "databaseRoleSplit=true",
  ]);
});

test("no value is passed while both flags are off", () => {
  expect(
    postgresqlFlagArgs(
      environment({
        "postgresql-service-class-instances": false,
        "database-role-split": false,
      }),
      "kore-postgresql-api",
    ),
  ).toEqual([]);
});

test("the role-split value reaches the PostgreSQL RBAC chart beside its own flag", () => {
  expect(
    postgresqlFlagArgs(
      environment({ "database-role-split": true }),
      "kore-postgresql-rbac",
    ),
  ).toEqual(["--set", "databaseRoleSplit=true"]);
});
