// Docs: docs/decisions/0154-workloads-run-two-replicas-roll-out-one-surge-pod-at-a-time-and-keep-a-disruption-budget.md
import { expect, test } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import { platformHelmArgs } from "./platform-domain.js";

test("the PostgreSQL composition is handed its service-class values only while postgresql-service-class-instances is on, and no other chart is", () => {
  const args = (features: Record<string, boolean>, component: string) =>
    platformHelmArgs(
      fakeEnvironment({
        platform: { domain: "kore.internal", organizationId: "platform" },
        gateway: { namespace: "kore-system", name: "kore-gateway", port: 8443 },
        features,
      }),
      component,
    );
  const on = { "postgresql-service-class-instances": true };
  expect(args(on, "kore-postgresql-api")).toEqual([
    "--set",
    "serviceClassInstances=true",
  ]);
  expect(args(on, "kore-postgresql-rbac")).toEqual([]);
  expect(args(on, "kore-platform-config")).not.toContain(
    "serviceClassInstances=true",
  );
  expect(
    args(
      { "postgresql-service-class-instances": false },
      "kore-postgresql-api",
    ),
  ).toEqual([]);
  expect(args({}, "kore-postgresql-api")).toEqual([]);
});

test("with database-routes and the service-class flag both on, the PostgreSQL composition gets both sets of values", () => {
  const args = platformHelmArgs(
    fakeEnvironment({
      platform: { domain: "kore.internal", organizationId: "platform" },
      gateway: { namespace: "kore-system", name: "kore-gateway", port: 8443 },
      features: {
        "database-routes": true,
        "postgresql-service-class-instances": true,
      },
    }),
    "kore-postgresql-api",
  );
  expect(args).toContain("serviceClassInstances=true");
  expect(args).toContain("databaseRoutes=true");
});
