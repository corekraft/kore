import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// Docs: docs/decisions/0093-a-nightly-job-proves-the-live-lifecycle-on-hosted-runners.md
// The nightly runs only named `test:integration:<name>` suites, so an
// integration spec that no named script runs is never proved at night.

const kore = new URL("../../", import.meta.url).pathname;
const scripts = (
  JSON.parse(readFileSync(join(kore, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;
const named = Object.entries(scripts)
  .filter(([name]) => name.startsWith("test:integration:"))
  .map(([, command]) => command)
  .join("\n");

// Run by the bare `test:integration` task only, which the nightly skips: the
// cluster spec deletes the night's cluster and the platform spec runs the unit
// suite.
const bareOnly = new Set([
  "cluster/cluster.integration.spec",
  "platform/platform.integration.spec",
]);

function integrationSpecs(dir: string): string[] {
  return readdirSync(join(kore, "src", dir))
    .filter((file) => file.endsWith(".integration.spec.ts"))
    .map((file) => `${dir}/${file.replace(/\.ts$/, "")}`);
}

test("every integration spec except the two bare-only ones is run by a named nightly suite", () => {
  const specs = ["cluster", "platform", "ops", "images", "app"].flatMap(
    integrationSpecs,
  );
  const missing = specs.filter(
    (spec) =>
      !bareOnly.has(spec) &&
      !named.includes(`dist/src/${spec}.js`) &&
      !named.includes(`dist/src/${spec.split("/")[0]}/*.integration.spec.js`),
  );
  expect(missing).toEqual([]);
});
