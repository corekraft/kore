import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0134-the-shared-gateway-admits-routes-only-from-platform-labelled-namespaces.md

const root = await findRoot();
const chart = join(root, "infra/charts/platform-apis");

/** The chart rendered with the given extra Helm arguments, as kore passes them. */
function render(...extra: string[]): string {
  return execFileSync(
    "helm",
    [
      "template",
      "kore-platform-apis",
      chart,
      "--set-string",
      "platformDomain=kore.internal",
      ...extra,
    ],
    { encoding: "utf8" },
  );
}

/** The Service composition's document, which Helm leaves as the Crossplane template it carries. */
function serviceComposition(rendered: string): string {
  const documents = rendered.split(/^---$/m);
  const found = documents.find((document) =>
    /^  name: service-local$/m.test(document),
  );
  assert.ok(found, "the chart renders the service-local Composition");
  return found;
}

const tenantAndOrganization = [
  "                platform.kore.dev/tenant: {{ $org }}",
  "                platform.kore.dev/organization: {{ $org }}",
];

test("with platform-shared-gateway on, the Service composition labels each namespace it creates for the shared Gateway", () => {
  const composition = serviceComposition(
    render("--set", "features.platform-shared-gateway=true"),
  );
  assert.ok(
    composition.includes(
      [
        ...tenantAndOrganization,
        '                platform.kore.dev/shared-gateway: "true"',
        "            {{- end }}",
      ].join("\n"),
    ),
    "the namespace carries the shared-gateway label after its tenant and organization",
  );
});

test("with platform-shared-gateway off, the Service composition's namespace labels are the tenant and organization only", () => {
  const composition = serviceComposition(
    render("--set", "features.platform-shared-gateway=false"),
  );
  assert.ok(
    composition.includes(
      [...tenantAndOrganization, "            {{- end }}"].join("\n"),
    ),
    "the namespace labels are exactly as they were before the label was added",
  );
  assert.doesNotMatch(composition, /shared-gateway/);
});

test("with platform-shared-gateway absent, the Service composition carries no shared-gateway label", () => {
  const composition = serviceComposition(render());
  assert.doesNotMatch(composition, /shared-gateway/);
  assert.ok(
    composition.includes(
      [...tenantAndOrganization, "            {{- end }}"].join("\n"),
    ),
  );
});
