import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";

async function read(relative: string): Promise<string> {
  const repository = await loadRepository("local");
  return await readFile(join(repository.root, relative), "utf8");
}

const composition = () => read("infra/apis/postgresql/compositions/local.yaml");

function template(source: string, step: string): string {
  const start = source.indexOf(`- step: ${step}`);
  assert.ok(start >= 0, `composition has a ${step} step`);
  const next = source.indexOf("\n    - step:", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

test("Crossplane may only touch Secrets with the verbs the composition needs", async () => {
  const rbac = await read(
    "infra/charts/crossplane-postgresql-rbac/templates/rbac.yaml",
  );
  const role =
    rbac
      .split("\n---\n")
      .find((doc) => /name: crossplane-postgresql-secrets/.test(doc)) ?? "";
  const rule = role
    .split("  - apiGroups:")
    .find((block) => /resources: \[secrets\]/.test(block));
  assert.ok(rule, "a Secret rule exists");
  const verbs = /verbs: \[([^\]]*)\]/.exec(rule)?.[1] ?? "";
  assert.deepEqual(
    verbs.split(",").map((verb) => verb.trim()),
    ["get", "list", "watch", "create", "patch", "delete"],
  );
  assert.doesNotMatch(rbac, /"\*"|\[\*\]|deletecollection/);
  const clusterWide = rbac.split("\n---\n")[0] ?? "";
  assert.doesNotMatch(
    clusterWide
      .split("clusters/status")[1]
      ?.split("verbs: [")[1]
      ?.split("]")[0] ?? "",
    /create|delete|patch|update/,
    "the Cluster status subresource is read-only",
  );
});

test("the chart binds no Secret access; kore app up binds it per application namespace", async () => {
  const rbac = await read(
    "infra/charts/crossplane-postgresql-rbac/templates/rbac.yaml",
  );
  assert.doesNotMatch(rbac, /kind: RoleBinding/);
  assert.doesNotMatch(rbac, /\.Values/);
});

test("the composition reports CloudNativePG phase, failure and endpoint on the composite status", async () => {
  const source = await composition();
  const status = template(source, "project-status");
  assert.match(status, /\.observed\.resources/);
  assert.match(status, /\.phaseReason/);
  for (const field of ["phase", "failureReason", "host", "port", "endpoint"]) {
    assert.match(status, new RegExp(`^ +${field}:`, "m"), field);
  }
  assert.match(status, /kind: ClaimConditions/);
  assert.match(status, /type: DatabaseHealthy/);
  assert.match(status, /Cluster in healthy state/);
  assert.ok(
    source.indexOf("project-status") < source.indexOf("step: mark-ready"),
    "status projection runs before auto-ready",
  );
  assert.match(source, /function-auto-ready/);
});

test("the XRD status schema declares every projected status field", async () => {
  const xrd = await read(
    "infra/apis/postgresql/definitions/postgresqlinstance.yaml",
  );
  const status = xrd.slice(xrd.indexOf("status:"));
  for (const field of ["phase", "failureReason", "host", "port", "endpoint"]) {
    assert.match(status, new RegExp(`${field}:`), field);
  }
});

test("CloudNativePG labels the PVCs it creates with the claim's retention policy", async () => {
  const source = await composition();
  const cluster = template(source, "compose-cloudnative-pg");
  assert.match(
    cluster,
    /inheritedMetadata:\s*\n\s+labels:\s*\n\s+platform\.kore\.dev\/retention: \{\{ \.observed\.composite\.resource\.spec\.retentionPolicy \}\}/,
  );
});

test("the connection Secret exposes exactly the contracted keys and Retain selects retained storage", async () => {
  const source = await composition();
  const secret = template(source, "compose-cloudnative-pg").slice(
    source.indexOf("kind: Secret") - source.indexOf("- step: compose"),
  );
  const stringData = secret.slice(secret.indexOf("stringData:"));
  const keys = [...stringData.matchAll(/^ {14}(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(keys, [
    "host",
    "port",
    "database",
    "username",
    "passwordSecretRef",
    "sslmode",
  ]);
  assert.match(
    source,
    /if eq \.observed\.composite\.resource\.spec\.retentionPolicy "Retain" \}\}kore-retained\{\{ else \}\}kore-standard/,
  );
  assert.match(source, /kind: Cluster/);
  assert.doesNotMatch(source, /kind: PersistentVolumeClaim/);
});

test("the XRD accepts only the five portable inputs", async () => {
  const xrd = await read(
    "infra/apis/postgresql/definitions/postgresqlinstance.yaml",
  );
  const spec = xrd.slice(
    xrd.indexOf("            spec:"),
    xrd.indexOf("            status:"),
  );
  const props = [...spec.matchAll(/^ {16}(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(
    props.sort((a, b) => String(a).localeCompare(String(b))),
    [
      "compatibilityVersion",
      "connectionSecretName",
      "retentionPolicy",
      "serviceClass",
      "storageSize",
    ],
  );
});

test("database pods stay out of the ambient mesh because the operator is not meshed", async () => {
  const source = await composition();
  const cluster = template(source, "compose-cloudnative-pg");

  assert.match(
    cluster,
    /inheritedMetadata:\n\s+labels:\n[\s\S]*?istio\.io\/dataplane-mode: none/,
  );
});
