// Docs: docs/decisions/0139-each-database-gets-a-tls-route-in-its-own-namespace-for-postgres-17-and-18-behind-database-routes.md
import { expect, test } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import { platformHelmArgs } from "./platform-domain.js";

test("the PostgreSQL charts are handed their database-routes values only while the flag is on, and no other chart is", () => {
  const args = (features: Record<string, boolean>, component: string) =>
    platformHelmArgs(
      fakeEnvironment({
        platform: { domain: "kore.internal", organizationId: "platform" },
        gateway: { namespace: "kore-system", name: "kore-gateway", port: 8443 },
        features,
      }),
      component,
    );
  const on = { "database-routes": true };
  expect(args(on, "kore-postgresql-rbac")).toEqual([
    "--set",
    "databaseRoutes=true",
  ]);
  expect(args(on, "kore-postgresql-api")).toEqual([
    "--set",
    "databaseRoutes=true",
    "--set-string",
    "platformDomain=kore.internal",
    "--set-string",
    "organizationId=platform",
    "--set-string",
    "gateway.name=kore-gateway",
    "--set-string",
    "gateway.namespace=kore-system",
  ]);
  expect(args({ "database-routes": false }, "kore-postgresql-api")).toEqual([]);
  expect(args({ "database-routes": false }, "kore-postgresql-rbac")).toEqual(
    [],
  );
  expect(args({}, "kore-postgresql-rbac")).toEqual([]);
  expect(args(on, "kore-platform-config")).not.toContain("databaseRoutes=true");
});
