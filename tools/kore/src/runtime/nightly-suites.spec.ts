import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// Docs: docs/decisions/0093-the-nightly-live-proof-runs-on-a-hosted-linux-runner-under-bounded-timeouts.md
// The nightly runs only named `test:integration:<name>` suites, so an
// integration spec that registers a test but that no named script runs is never
// proved at night, and a named script that runs only helper modules (no test)
// passes green while proving nothing.

const kore = new URL("../../", import.meta.url).pathname;
const src = join(kore, "src");
const scripts = (
  JSON.parse(readFileSync(join(kore, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;
const named = Object.entries(scripts).filter(([name]) =>
  name.startsWith("test:integration:"),
);

// Run by the bare `test:integration` task only, which the nightly skips: the
// cluster spec deletes the night's cluster and the platform spec runs the unit
// suite.
const bareOnly = new Set([
  "cluster/cluster.integration.spec",
  "platform/platform.integration.spec",
]);

const registersTest = (spec: string): boolean =>
  /^\s*test(?:\.\w+)?\(/m.test(readFileSync(join(src, `${spec}.ts`), "utf8"));

const integrationSpecs = readdirSync(src, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".integration.spec.ts"))
  .map((file) => file.replace(/\.ts$/, ""));

// What a script runs: explicit files, or the files a `dir/*.integration.spec.js` glob matches.
const runs = (command: string, spec: string): boolean =>
  command.includes(`dist/src/${spec}.js`) ||
  command.includes(
    `dist/src/${spec.split("/").slice(0, -1).join("/")}/*.integration.spec.js`,
  );

test("every integration spec that registers a test, except the bare-only ones, is run by a named nightly suite", () => {
  const missing = integrationSpecs.filter(
    (spec) =>
      registersTest(spec) &&
      !bareOnly.has(spec) &&
      !named.some(([, command]) => runs(command, spec)),
  );
  expect(missing).toEqual([]);
});

test("every named integration suite runs at least one spec that registers a test", () => {
  const vacuous = named
    .filter(
      ([, command]) =>
        !integrationSpecs.some(
          (spec) => registersTest(spec) && runs(command, spec),
        ),
    )
    .map(([name]) => name);
  expect(vacuous).toEqual([]);
});
