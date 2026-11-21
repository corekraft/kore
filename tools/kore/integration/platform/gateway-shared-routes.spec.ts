// Docs: docs/decisions/0133-the-platform-owns-the-gateway-its-listeners-and-its-certificate-charts-own-routes-only.md
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "vitest";
import { loadRepository, type Repository } from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";
import {
  withAbsoluteChart,
  withGatewayFlagsOff,
} from "../../src/testing/index.js";

// With platform-shared-gateway on, the shared Gateway admits routes only from
// namespaces carrying the platform-owned label, and the platform's own
// namespace carries it. With the flag off, allowed routes are unchanged.

const label = "platform.kore.dev/shared-gateway";

function render(repository: Repository): string {
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-platform-config",
  )!;
  return execFileSync(
    "helm",
    withAbsoluteChart(
      repository,
      component,
      helmTemplateArgs(repository, component),
    ),
    { cwd: repository.root, encoding: "utf8" },
  );
}

function withSharedGateway(repository: Repository, on: boolean): Repository {
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        "platform-shared-gateway": on,
        // ADR 0132: the deprecated alias listener is served only while platform-dns is on, and withGatewayFlagsOff pins it off, so these renders state it on.
        "platform-dns": true,
      },
    },
  };
}

const admitAll = /allowedRoutes:\s+namespaces: \{from: All\}/g;
const admitLabelled = new RegExp(
  `allowedRoutes:\\s+namespaces: \\{from: Selector, selector: \\{matchLabels: \\{${label.replaceAll(".", "\\.")}: "true"\\}\\}\\}`,
  "g",
);

test("with platform-shared-gateway off the HTTPS listeners admit routes from every namespace, as before", async () => {
  const output = render(
    withSharedGateway(
      withGatewayFlagsOff(await loadRepository("local")),
      false,
    ),
  );
  // The domain listener admits every namespace; the deprecated alias listener is removed (ADR 0176).
  assert.equal(output.match(admitAll)?.length, 1);
  assert.doesNotMatch(output, admitLabelled);
});

test("with platform-shared-gateway off the kore-system namespace carries no shared-gateway label", async () => {
  const output = render(
    withSharedGateway(
      withGatewayFlagsOff(await loadRepository("local")),
      false,
    ),
  );
  assert.doesNotMatch(output, new RegExp(label.replaceAll(".", "\\.")));
});

test("with platform-shared-gateway on every HTTPS listener admits routes only from namespaces carrying the label", async () => {
  const output = render(
    withSharedGateway(withGatewayFlagsOff(await loadRepository("local")), true),
  );
  // The domain and the organization wildcard listeners each admit only labelled namespaces.
  assert.equal(output.match(admitLabelled)?.length, 2);
  assert.doesNotMatch(output, admitAll);
});

test("with platform-shared-gateway on the kore-system namespace, where the Gateway lives, carries the label", async () => {
  const output = render(
    withSharedGateway(withGatewayFlagsOff(await loadRepository("local")), true),
  );
  assert.match(
    output,
    new RegExp(
      `kind: Namespace\\s+metadata:\\s+name: kore-system\\s+labels: \\{app\\.kubernetes\\.io/managed-by: Helm, ${label.replaceAll(".", "\\.")}: "true"\\}`,
    ),
  );
});
