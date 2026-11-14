import assert from "node:assert/strict";
import { test } from "vitest";
import { readinessFor } from "../../src/config/readiness-fixtures.js";
import { loadManagedLocal, managedClusterSettings } from "../../src/testing/index.js";
import { sound, validationMessage } from "../../src/config/validation.fixtures.js";

const badComponents = [
  {
    ...sound,
    name: "BAD_NAME",
    phase: "x",
    kind: "x",
    namespace: "",
    timeout: "0m",
    version: "unknown",
    chart: undefined,
    values: ["missing.yaml"],
    dependencies: ["missing-dependency"],
    ownsCRDs: ["things.shared.example.com"],
  },
  {
    ...sound,
    name: "also-bad",
    ownsCRDs: ["things.shared.example.com"],
  },
  { ...sound, name: "also-bad", kind: "manifest", chart: undefined },
  { ...sound, name: "cyc-a", dependencies: ["cyc-b"] },
  { ...sound, name: "cyc-b", dependencies: ["cyc-a"] },
];

test("validation reports every rule violation exactly once, sorted", async () => {
  const message = await validationMessage(
    (base) => ({
      ...base,
      versions: {
        ...base.versions,
        kubernetes: "latest",
        tools: { broken: "main" },
        components: { invalid: "1" },
      },
      environment: {
        ...base.environment,
        enrollmentExemptions: {},
        providerOwnedCRDGroups: {},
        name: "BAD_NAME",
        provider: "other",
        kubeContext: "",
        cluster: { ...managedClusterSettings, cpus: 1, memoryMB: 1 },
        componentValues: { "also-bad": ["missing-env.yaml"], ghost: [] },
      },
      readiness: readinessFor("BAD_NAME", "also-bad", "cyc-a", "cyc-b"),
      catalog: {
        components: badComponents,
      },
    }),
    loadManagedLocal,
  );
  assert.equal(
    message,
    [
      "BAD_NAME: chart is required",
      "BAD_NAME: invalid kind",
      "BAD_NAME: invalid phase",
      "BAD_NAME: namespace and bounded timeout are required",
      "BAD_NAME: unknown dependency missing-dependency",
      "BAD_NAME: unknown version key unknown",
      "BAD_NAME: values file does not exist: missing.yaml",
      "CRD things.shared.example.com has multiple owners: BAD_NAME and also-bad",
      "also-bad: environment values file does not exist: missing-env.yaml",
      "also-bad: manifest source is required",
      "component has invalid name: BAD_NAME",
      "components.invalid must be an exact semantic version",
      "duplicate component: also-bad",
      "environment.cluster.cpus must be at least 2",
      "environment.cluster.memoryMB must be at least 4096",
      "environment.kubeContext is required",
      "environment.name is invalid",
      "environment.provider must be k3d or managed",
      "release dependency cycle includes: BAD_NAME, cyc-a, cyc-b",
      "tools.broken must be an exact semantic version",
      "unknown environment component values: ghost",
      "versions.kubernetes must be an exact semantic version",
    ].join("\n"),
  );
});

test("validation reports malformed version sections and missing sections", async () => {
  const message = await validationMessage(
    (base) => ({
      ...base,
      versions: { kubernetes: "", images: {} },
      environment: {
        ...base.environment,
        cluster: undefined,
        enrollmentExemptions: {},
      },
      readiness: readinessFor(),
      catalog: {},
    }),
    loadManagedLocal,
  );
  assert.equal(
    message,
    [
      "Cannot read properties of undefined (reading 'map')",
      "environment.cluster.cpus must be at least 2",
      "environment.cluster.memoryMB must be at least 4096",
      "unknown environment component values: grafana",
      "unknown environment component values: istio-cni",
      "unknown environment component values: kore-image-policy",
      "unknown environment component values: kore-local-tls",
      "unknown environment component values: kore-platform-config",
      "unknown environment component values: kore-storage",
      "unknown environment component values: loki",
      "unknown environment component values: otel-agent",
      "unknown environment component values: otel-collector",
      "unknown environment component values: policy-controller",
      "unknown environment component values: prometheus",
      "unknown environment component values: tempo",
      "versions.components must be an object of pinned versions",
      "versions.kubernetes must be an exact semantic version",
      "versions.tools must be an object of pinned versions",
    ].join("\n"),
  );
});
