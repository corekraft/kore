// Docs: docs/decisions/0042-organization-domains-by-delegation.md
// The claim check in kore validate mirrors the XRD schemas in the chart. The
// chart stays the runtime owner, so this test fails when the two drift apart.
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import {
  dnsLabelPattern,
  mirroredXrdFragments,
} from "../../src/config/index.js";

const templates = new URL(
  "../../../../infra/charts/platform-apis/templates/",
  import.meta.url,
);

async function xrd(file: string): Promise<string> {
  return await readFile(new URL(file, templates), "utf8");
}

test("the chart's Organization and Service XRDs enforce the DNS label pattern the claim check mirrors", async () => {
  const organization = await xrd("organization-xrd.yaml");
  const service = await xrd("service-xrd.yaml");
  expect(organization).toContain(`pattern: "${dnsLabelPattern}"`);
  expect(service).toContain(`pattern: "${dnsLabelPattern}"`);
});

test("every XRD rule the claim check mirrors is still in the chart", async () => {
  const chart = [
    await xrd("organization-xrd.yaml"),
    await xrd("service-xrd.yaml"),
  ].join("\n");
  for (const fragment of mirroredXrdFragments) {
    expect(chart, `the chart lost the rule: ${fragment}`).toContain(fragment);
  }
});
