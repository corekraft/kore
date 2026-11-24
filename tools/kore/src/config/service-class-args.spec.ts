// Docs: docs/decisions/0154-workloads-run-two-replicas-roll-out-one-surge-pod-at-a-time-and-keep-a-disruption-budget.md
import { expect, test } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import { serviceClassArgs } from "./service-class-args.js";

const environment = (features: Record<string, boolean>) =>
  fakeEnvironment({
    platform: { domain: "kore.internal", organizationId: "platform" },
    gateway: { namespace: "kore-system", name: "kore-gateway", port: 8443 },
    features,
  });

test("the PostgreSQL API is handed the service-class value only while postgresql-service-class-instances is on", () => {
  expect(
    serviceClassArgs(
      environment({ "postgresql-service-class-instances": true }),
      "kore-postgresql-api",
    ),
  ).toEqual(["--set", "serviceClassInstances=true"]);
});

test("no value is passed while the flag is off or absent", () => {
  expect(
    serviceClassArgs(
      environment({ "postgresql-service-class-instances": false }),
      "kore-postgresql-api",
    ),
  ).toEqual([]);
  expect(serviceClassArgs(environment({}), "kore-postgresql-api")).toEqual([]);
});

test("only the PostgreSQL API takes the value, never another component", () => {
  expect(
    serviceClassArgs(
      environment({ "postgresql-service-class-instances": true }),
      "kore-platform-config",
    ),
  ).toEqual([]);
});
