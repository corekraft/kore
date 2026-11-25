// Docs: docs/decisions/0042-organization-domains-by-delegation.md
// The claim check in kore validate mirrors the XRD schemas in the chart. The
// chart stays the runtime owner, so this test fails when the chart drops a rule
// or pattern the mirror relies on. The expected values are literals here: the
// barrel-rule lint forbids reaching the config domain's files, and the mirror's
// own behaviour is covered by its unit spec.
import { readdir, readFile } from "node:fs/promises";
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
  "metadata.name must be at most 54 characters, so <suborg>--preview fits 63",
  'pattern: "^[a-z0-9]([a-z0-9]|-[a-z0-9])*$"',
  "metadata.name must start with a lowercase letter",
  "metadata.name must be at most 51 characters",
  // The Organization rules for a suborg (ADR 0165), as the claim check words them.
  "must not contain a double hyphen: the suborg namespace is <suborg>",
  "the platform organization is the tenant root and has no parent",
  "spec.parent is required for a suborg; set it to",
  'must be "platform", the tenant root: v1 places a suborg one level below it',
  "spec.quota is required for a suborg, and has no default: set requests.cpu, requests.memory, pods and storage",
];

/** The quota patterns the claim check mirrors, as the chart writes them. */
const quotaPatterns = [
  'pattern: "^[0-9]+(\\\\.[0-9]+)?m?$"',
  'pattern: "^[0-9]+(\\\\.[0-9]+)?(Mi|Gi|Ti)$"',
  'pattern: "^[0-9]+(\\\\.[0-9]+)?(Gi|Ti)$"',
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

test("the Organization XRD's quota patterns are the ones the claim check mirrors", async () => {
  const organization = await xrd("organization-xrd.yaml");
  for (const pattern of quotaPatterns) {
    expect(
      organization,
      `the chart lost the quota pattern: ${pattern}`,
    ).toContain(pattern);
  }
});

test("the Service XRD's database entry carries the fields the backup rules read, and backup is an opt-in that defaults to false", async () => {
  const service = await xrd("service-xrd.yaml");
  expect(service).toContain("required: [name, version, size, retentionPolicy]");
  expect(service).toContain("enum: [Delete, Retain]");
  expect(service).toMatch(/type: boolean,\s+default: false,/);
});

test("a suborg's zone is refused unless it is <suborg>.<platform domain>, inside the hostname-ownership flag", async () => {
  const organization = await xrd("organization-xrd.yaml");
  expect(organization).toContain(
    `{{- if index $features "platform-hostname-ownership" }}`,
  );
  expect(organization).toContain(
    `self.spec.zone == self.metadata.name + '.%s'`,
  );
});

test("every literal namespace a chart creates is one the suborg names refuse: a catalog namespace, a reserved name or a reserved prefix", async () => {
  const catalog = await readFile(
    new URL("../../../../infra/catalog/components.yaml", import.meta.url),
    "utf8",
  );
  const catalogNamespaces = new Set(
    [...catalog.matchAll(/"namespace": "([^"]+)"/g)].map((m) => m[1]),
  );
  const extra = new Set(["default", "internal", "www", "reference"]);
  const charts = new URL("../../../../infra/charts/", import.meta.url);
  const files = (await readdir(charts, { recursive: true })).filter(
    (file) => file.includes("templates/") && file.endsWith(".yaml"),
  );
  for (const file of files) {
    const text = await readFile(new URL(file, charts), "utf8");
    for (const document of text.split(/^---$/m)) {
      if (!/^kind: Namespace$/m.test(document)) {
        continue;
      }
      const name = /^ {2}name: ([a-z0-9-]+)$/m.exec(document)?.[1];
      if (name === undefined) {
        continue;
      }
      const reserved =
        catalogNamespaces.has(name) ||
        extra.has(name) ||
        name.startsWith("kube-") ||
        name.startsWith("kore-");
      expect(
        reserved,
        `${file} creates the namespace ${name}, which suborg names do not reserve`,
      ).toBe(true);
    }
  }
});
