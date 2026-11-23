import assert from "node:assert/strict";
import { test } from "vitest";
import {
  chart,
  databaseRoutes,
  inlineTemplate,
  kind,
  renderStep,
} from "./platform.postgresql-chart-support.js";

// Docs: docs/decisions/0154-workloads-run-two-replicas-roll-out-one-surge-pod-at-a-time-and-keep-a-disruption-budget.md
// With postgresql-service-class-instances on, the composed CloudNativePG Cluster takes its
// instance count and sizing from the claim's serviceClass: standard gets two instances with
// the disruption budget on, development one with it off; every instance uses switchover and
// a memory request equal to its limit. Off, the Cluster is the one instance it was before.
// Rendered offline with helm, as the function would run the step.

const serviceClassFlag = ["--set", "serviceClassInstances=true"];

/** The Cluster's spec, from its `spec:` key to the end of its document, exactly as rendered. */
function clusterSpec(out: string): string {
  const cluster = kind(out, "Cluster");
  assert.ok(cluster, "a Cluster is composed");
  return cluster.slice(cluster.indexOf("\nspec:\n") + 1).trimEnd();
}

const imageAndStorage = [
  "  imageName: ghcr.io/cloudnative-pg/postgresql:17.4@sha256:3c0ba08ea353c9705a755c113e4ae395be76553e0ed68076e5410cb09b9d17d9",
  "  storage:",
  "    size: 5Gi",
  "    storageClass: kore-standard",
  "  bootstrap: {initdb: {database: app, owner: app}}",
];

const inheritedMetadata = [
  "  inheritedMetadata:",
  "    labels:",
  "      platform.kore.dev/retention: Delete",
  "      istio.io/dataplane-mode: none",
];

const sized = (instances: number, budget: boolean, memory: string) => [
  "spec:",
  `  instances: ${instances}`,
  `  enablePDB: ${budget}`,
  "  primaryUpdateMethod: switchover",
  "  resources:",
  "    requests:",
  `      memory: ${memory}`,
  "    limits:",
  `      memory: ${memory}`,
  ...inheritedMetadata,
  ...imageAndStorage,
];

const oneInstance = [
  "spec:",
  "  instances: 1",
  ...inheritedMetadata,
  ...imageAndStorage,
];

const certificates = [
  "  certificates:",
  "    serverTLSSecret: orders-db-server-tls",
  "    serverCASecret: orders-db-server-tls",
];

async function composedSpec(
  serviceClass: string,
  set: string[] = [],
): Promise<string> {
  const template = inlineTemplate(
    await chart(...set),
    "compose-cloudnative-pg",
  );
  return clusterSpec(
    await renderStep(template, 17, undefined, undefined, serviceClass),
  );
}

test("with the flag off a standard claim composes the one-instance Cluster, with no sizing and no disruption setting", async () => {
  assert.equal(await composedSpec("standard"), oneInstance.join("\n"));
});

test("with the flag off a development claim composes the same one-instance Cluster", async () => {
  assert.equal(await composedSpec("development"), oneInstance.join("\n"));
});

test("with the flag on a standard claim composes two instances with the disruption budget on, switchover, and memory request equal to limit", async () => {
  assert.equal(
    await composedSpec("standard", serviceClassFlag),
    sized(2, true, "1Gi").join("\n"),
  );
});

test("with the flag on a development claim composes one instance with the disruption budget off, switchover, and memory request equal to limit", async () => {
  assert.equal(
    await composedSpec("development", serviceClassFlag),
    sized(1, false, "512Mi").join("\n"),
  );
});

test("with the flag on and database-routes on, the sized Cluster keeps its certificates and the route still targets the read-write Service", async () => {
  const set = [...databaseRoutes, ...serviceClassFlag];
  const template = inlineTemplate(
    await chart(...set),
    "compose-cloudnative-pg",
  );
  const out = await renderStep(template, 17, undefined, undefined, "standard");
  assert.equal(
    clusterSpec(out),
    [...sized(2, true, "1Gi"), ...certificates].join("\n"),
  );
  assert.match(out, /backendRefs:\n\s+- name: orders-db-rw\n\s+port: 5432/);
});

test("with the flag off and database-routes on, the Cluster keeps its one instance and no sizing", async () => {
  const set = [...databaseRoutes];
  const template = inlineTemplate(
    await chart(...set),
    "compose-cloudnative-pg",
  );
  const out = await renderStep(template, 17, undefined, undefined, "standard");
  assert.equal(clusterSpec(out), [...oneInstance, ...certificates].join("\n"));
});
