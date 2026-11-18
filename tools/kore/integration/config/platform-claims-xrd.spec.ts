// Docs: docs/decisions/0042-organization-domains-by-delegation.md
// The claim check in kore validate mirrors the XRD schemas in the chart. The
// chart stays the runtime owner, so this test fails when the chart drops a rule
// or pattern the mirror relies on. The expected values are literals here: the
// barrel-rule lint forbids reaching the config domain's files, and the mirror's
// own behaviour is covered by its unit spec.
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

const templates = new URL(
  "../../../../infra/charts/platform-apis/templates/",
  import.meta.url,
);

/** The DNS label pattern the XRDs apply to tenant, parent and environment names. */
const dnsLabelPattern = "^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$";

/** Rule messages the mirror relies on; each must still appear in the chart. */
const mirroredRules = [
  "metadata.name must be a single DNS label",
  "metadata.name must not contain a double hyphen",
  "spec.environments must not contain a double hyphen",
  "must be at most 63 characters",
  "must not use a reserved prefix",
  "only the platform organization is supported",
  "enum: [platform]",
  "metadata.name must start with a lowercase letter",
  "metadata.name must be at most 51 characters",
];

async function xrd(file: string): Promise<string> {
  return await readFile(new URL(file, templates), "utf8");
}

test("the chart's Organization and Service XRDs enforce the DNS label pattern the claim check mirrors", async () => {
  const organization = await xrd("organization-xrd.yaml");
  const service = await xrd("service-xrd.yaml");
  expect(organization).toContain(`pattern: "${dnsLabelPattern}"`);
  expect(service).toContain(`pattern: "${dnsLabelPattern}"`);
});

test("the Service XRD requires a leading letter and caps the name at 51 characters", async () => {
  const service = await xrd("service-xrd.yaml");
  expect(service).toContain(`rule: "self.metadata.name.matches('^[a-z]')"`);
  expect(service).toContain(`rule: "self.metadata.name.size() <= 51"`);
});

test("every XRD rule the claim check mirrors is still in the chart", async () => {
  const chart = [
    await xrd("organization-xrd.yaml"),
    await xrd("service-xrd.yaml"),
  ].join("\n");
  for (const rule of mirroredRules) {
    expect(chart, `the chart lost the rule: ${rule}`).toContain(rule);
  }
});
