import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, orderedComponents } from "../config/index.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("release graph order is stable", async () => {
  const repository = await loadRepository("local");
  const first = orderedComponents(repository.catalog).map(({ name }) => name);
  const second = orderedComponents(repository.catalog).map(({ name }) => name);
  assert.deepEqual(first, second);
  assert.ok(
    first.indexOf("cert-manager") < first.indexOf("opentelemetry-operator"),
  );
  assert.ok(
    first.indexOf("crossplane") < first.indexOf("kore-platform-config"),
  );
  assert.ok(
    first.indexOf("opentelemetry-operator") <
      first.indexOf("kore-platform-config"),
  );
});

test("storage primitives are installed before observability claims PVCs", async () => {
  const repository = await loadRepository("local");
  const order = orderedComponents(repository.catalog).map(({ name }) => name);

  assert.ok(order.indexOf("kore-storage") >= 0);
  assert.ok(order.indexOf("kore-storage") < order.indexOf("loki"));
  assert.ok(
    order.indexOf("kore-storage") < order.indexOf("kore-platform-config"),
  );
});

test("Crossplane database permissions are installed before the PostgreSQL API", async () => {
  const repository = await loadRepository("local");
  const order = orderedComponents(repository.catalog).map(({ name }) => name);

  assert.ok(order.indexOf("kore-postgresql-rbac") >= 0);
  assert.ok(
    order.indexOf("kore-postgresql-rbac") <
      order.indexOf("kore-postgresql-api"),
  );
});

test("Gateway chart does not create its TLS certificate in the same release", async () => {
  const repository = await loadRepository("local");
  const gateway = await readFile(
    join(
      repository.root,
      "infra/charts/platform-config/templates/gateway.yaml",
    ),
    "utf8",
  );

  assert.match(gateway, /kind: Gateway/);
  assert.doesNotMatch(gateway, /kind: Certificate/);
});

test("local Gateway uses a non-privileged HTTPS port so Minikube tunnel needs no sudo", async () => {
  const repository = await loadRepository("local");
  const values = await readFile(
    join(
      repository.root,
      "infra/environments/local/values/platform-config.yaml",
    ),
    "utf8",
  );
  const gateway = await readFile(
    join(
      repository.root,
      "infra/charts/platform-config/templates/gateway.yaml",
    ),
    "utf8",
  );
  const policies = await readFile(
    join(
      repository.root,
      "infra/charts/platform-config/templates/mesh-policy.yaml",
    ),
    "utf8",
  );

  assert.match(values, /port:\s*8443/);
  assert.match(gateway, /port:\s*{{ \.Values\.gateway\.port }}/);
  assert.match(policies, /ports:\s*\[{{ \.Values\.gateway\.port \| quote }}\]/);
});

test("platform authorization allows HTTPS only to the named Gateway", async () => {
  const repository = await loadRepository("local");
  const policies = await readFile(
    join(
      repository.root,
      "infra/charts/platform-config/templates/mesh-policy.yaml",
    ),
    "utf8",
  );

  assert.match(policies, /name: gateway-allow-https/);
  assert.match(
    policies,
    /gateway\.networking\.k8s\.io\/gateway-name: kore-gateway/,
  );
  assert.match(policies, /action: ALLOW/);
  assert.match(policies, /ports:\s*\[{{ \.Values\.gateway\.port \| quote }}\]/);
});

test("reference API L7 authorization is attached to an enrolled ambient waypoint", async () => {
  const repository = await loadRepository("local");
  const workload = await readFile(
    join(
      repository.root,
      "apps/reference/charts/workload/templates/workloads.yaml",
    ),
    "utf8",
  );

  assert.match(workload, /gatewayClassName:\s*istio-waypoint/);
  assert.match(workload, /name:\s*reference-api-waypoint/);
  assert.match(workload, /istio\.io\/dataplane-mode:\s*ambient/);
  assert.match(workload, /istio\.io\/use-waypoint:\s*reference-api-waypoint/);
  assert.match(
    workload,
    /targetRefs:\s*\n\s+- group:\s*""\s*\n\s+kind:\s*Service\s*\n\s+name:\s*reference-api/,
  );
  assert.match(workload, /action:\s*CUSTOM/);
  assert.match(
    workload,
    /principals:\s*\["cluster\.local\/ns\/\{\{ \.Release\.Namespace \}\}\/sa\/reference-api-waypoint"\]/,
  );
});

test("OpenTelemetry collector readiness targets the pinned chart deployment", async () => {
  const repository = await loadRepository("local");
  const collector = repository.catalog.components.find(
    ({ name }) => name === "otel-collector",
  )!;

  assert.deepEqual(collector.readiness, ["deployment/otel-collector"]);
});

test("local storage classes use binding compatible with the Minikube hostpath provisioner", async () => {
  const repository = await loadRepository("local");
  const storage = await readFile(
    join(
      repository.root,
      "infra/charts/platform-storage/templates/storage.yaml",
    ),
    "utf8",
  );

  assert.equal(
    (storage.match(/volumeBindingMode: Immediate/g) ?? []).length,
    2,
  );
});

test("local Loki configuration declares filesystem storage buckets", async () => {
  const repository = await loadRepository("local");
  const values = await readFile(
    join(repository.root, "infra/environments/local/values/loki.yaml"),
    "utf8",
  );

  assert.match(values, /type:\s*filesystem/);
  assert.match(values, /bucketNames:\s*\n\s+chunks:/);
  assert.match(values, /\n\s+ruler:/);
  assert.match(values, /chunksCache:\s*\n\s+enabled:\s*false/);
  assert.match(values, /resultsCache:\s*\n\s+enabled:\s*false/);
});

test("local Grafana does not require an unmaterialized admin Secret", async () => {
  const repository = await loadRepository("local");
  const values = await readFile(
    join(repository.root, "infra/environments/local/values/grafana.yaml"),
    "utf8",
  );

  assert.doesNotMatch(values, /existingSecret:/);
  assert.match(values, /anonymous:\s*\n\s+enabled:\s*true/);
});

test("local Grafana does not chown existing hostpath data on startup", async () => {
  const repository = await loadRepository("local");
  const values = await readFile(
    join(repository.root, "infra/environments/local/values/grafana.yaml"),
    "utf8",
  );

  assert.match(values, /initChownData:\s*\n\s+enabled:\s*false/);
});
