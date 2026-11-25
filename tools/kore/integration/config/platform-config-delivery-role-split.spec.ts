import assert from "node:assert/strict";
import { test } from "vitest";
import {
  renderDelivery,
  withFlags,
} from "../platform-config-delivery-project-support.js";

// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md
// Argo CD renders the PostgreSQL API's Application from the delivery chart. With database-role-split
// on, that Application takes the databaseRoleSplit parameter, so the Argo render matches the Helm
// render; off, the Application carries no such parameter and renders as it did before the flag.

const postgresqlApplication = (docs: string[]): string => {
  const found = docs.find((doc) =>
    /^kind: Application\n {0}metadata:\n {2}name: kore-postgresql-api$/m.test(
      doc,
    ),
  );
  assert.ok(found, "the PostgreSQL API's Application is rendered");
  return found;
};

test("with database-role-split on the PostgreSQL API's Application takes the databaseRoleSplit parameter", async () => {
  const { docs } = await renderDelivery(await withFlags(true));
  assert.match(
    postgresqlApplication(docs),
    /name: "databaseRoleSplit"\n\s+value: "true"/,
  );
});

test("with database-role-split off the PostgreSQL API's Application carries no databaseRoleSplit parameter", async () => {
  const { docs } = await renderDelivery(await withFlags(false));
  assert.doesNotMatch(postgresqlApplication(docs), /databaseRoleSplit/);
});
