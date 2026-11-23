import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0032-application-namespace-image-admission.md (refined by the enrolment decision for the golden-path creators)

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
const enrolment = '                policy.sigstore.dev/include: "true"';
const end = "            {{- end }}";

test("with golden-path-template-admission on, the Service composition enrols each namespace it creates for policy.sigstore.dev/include", () => {
  const composition = serviceComposition(
    render("--set", "features.golden-path-template-admission=true"),
  );
  assert.ok(
    composition.includes([...tenantAndOrganization, enrolment, end].join("\n")),
    "the namespace carries the enrolment label after its tenant and organization",
  );
});

test("with golden-path-template-admission and platform-shared-gateway both on, one namespace carries both labels", () => {
  const composition = serviceComposition(
    render(
      "--set",
      "features.golden-path-template-admission=true",
      "--set",
      "features.platform-shared-gateway=true",
    ),
  );
  assert.ok(
    composition.includes(
      [
        ...tenantAndOrganization,
        '                platform.kore.dev/shared-gateway: "true"',
        enrolment,
        end,
      ].join("\n"),
    ),
    "the shared-gateway label and the enrolment label sit together after the organization",
  );
});

test("with golden-path-template-admission off, the Service composition's namespace labels carry no enrolment label", () => {
  const composition = serviceComposition(
    render("--set", "features.golden-path-template-admission=false"),
  );
  assert.doesNotMatch(composition, /policy\.sigstore\.dev\/include/);
  assert.ok(
    composition.includes([...tenantAndOrganization, end].join("\n")),
    "the namespace labels are exactly the tenant and organization, as before the flag",
  );
});

test("with golden-path-template-admission absent, the Service composition carries no enrolment label", () => {
  const composition = serviceComposition(render());
  assert.doesNotMatch(composition, /policy\.sigstore\.dev\/include/);
});
