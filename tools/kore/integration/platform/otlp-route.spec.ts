// Docs: docs/decisions/0140-otlp-is-routed-by-name-to-the-standard-collector-receiver-behind-otlp-route.md
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "vitest";
import { loadRepository, type Repository } from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";
import { withAbsoluteChart } from "../../src/testing/index.js";

// With otlp-route on, the shared Gateway's HTTPS listener for the platform
// wildcard carries one HTTPRoute for otlp.platform.kore.internal, which reaches
// the collector's standard OTLP/HTTP receiver on 4318 (ADR 0140). The loopback-only
// receiver on 4319 is never routed. Off, the chart renders nothing. These specs
// render the real chart, as the Helm path does, without a cluster.

const component = "kore-otlp-route";

function render(repository: Repository, overrides: string[] = []): string {
  const found = repository.catalog.components.find((c) => c.name === component);
  assert.ok(found, `${component} is in the catalog`);
  return execFileSync(
    "helm",
    withAbsoluteChart(repository, found, [
      ...helmTemplateArgs(repository, found),
      ...overrides,
    ]),
    { cwd: repository.root, encoding: "utf8" },
  );
}

async function repositoryWith(
  flags: Record<string, boolean>,
): Promise<Repository> {
  const base = await loadRepository("local");
  return {
    ...base,
    environment: {
      ...base.environment,
      platform: { domain: "kore.internal", organizationId: "platform" },
      features: {
        ...base.environment.features,
        "platform-dns": false,
        "platform-shared-gateway": true,
        ...flags,
      },
    },
  };
}

test("with otlp-route on the shared Gateway's HTTPS listener routes otlp.platform.kore.internal to the collector's standard OTLP/HTTP receiver on 4318", async () => {
  const repository = await repositoryWith({ "otlp-route": true });
  const output = render(repository);
  assert.equal(
    output.trim(),
    `---
# Source: otlp-route/templates/httproute.yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: otlp
  namespace: observability
  labels: {app.kubernetes.io/managed-by: Helm}
spec:
  parentRefs:
    - group: gateway.networking.k8s.io
      kind: Gateway
      name: ${repository.environment.gateway.name}
      namespace: ${repository.environment.gateway.namespace}
      sectionName: https-platform
  hostnames:
    - "otlp.platform.kore.internal"
  rules:
    - backendRefs:
        - name: otel-collector
          port: 4318`,
  );
});

test("with otlp-route on the route never reaches the loopback-only receiver on 4319", async () => {
  const repository = await repositoryWith({ "otlp-route": true });
  assert.doesNotMatch(render(repository), /4319/);
});

test("with otlp-route off the chart renders nothing, so the flag-off install is unchanged", async () => {
  const repository = await repositoryWith({ "otlp-route": false });
  assert.equal(render(repository).trim(), "");
});

test("with otlp-route on the chart refuses to render until the Gateway's name is set, naming the field", async () => {
  const repository = await repositoryWith({ "otlp-route": true });
  assert.throws(
    () => render(repository, ["--set-string", "otlpRoute.gateway.name="]),
    /otlpRoute\.gateway\.name/,
  );
});

test("the chart's values are closed: an unknown value is refused before anything renders", async () => {
  const repository = await repositoryWith({ "otlp-route": true });
  assert.throws(
    () => render(repository, ["--set", "otlpRoute.unknown=true"]),
    /unknown|additional/i,
  );
});
