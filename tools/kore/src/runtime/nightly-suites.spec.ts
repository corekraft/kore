import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// Docs: docs/decisions/0093-the-nightly-live-proof-runs-on-a-hosted-linux-runner-under-bounded-timeouts.md
// The nightly runs only named `test:live:<name>` suites, so an
// live spec that registers a test but that no named script runs is never
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
  name.startsWith("test:live:"),
);

// Run by the bare `test:live` task only, which the nightly skips: the
// cluster spec deletes the night's cluster and the platform spec runs the unit
// suite.
const bareOnly = new Set([
  "cluster/cluster.live.spec",
  "platform/platform.live.spec",
]);

const registersTest = (spec: string): boolean =>
  /^\s*test(?:\.\w+)?\(/m.test(readFileSync(join(src, `${spec}.ts`), "utf8"));

const liveSpecs = readdirSync(src, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".live.spec.ts"))
  .map((file) => file.replace(/\.ts$/, ""));

// What a script runs: explicit files, or the files a `dir/*.live.spec.js` glob matches.
const runs = (command: string, spec: string): boolean =>
  command.includes(`dist/src/${spec}.js`) ||
  command.includes(
    `dist/src/${spec.split("/").slice(0, -1).join("/")}/*.live.spec.js`,
  );

test("every live spec that registers a test, except the bare-only ones, is run by a named nightly suite", () => {
  const missing = liveSpecs.filter(
    (spec) =>
      registersTest(spec) &&
      !bareOnly.has(spec) &&
      !named.some(([, command]) => runs(command, spec)),
  );
  expect(missing).toEqual([]);
});

test("every named live suite runs at least one spec that registers a test", () => {
  const vacuous = named
    .filter(
      ([, command]) =>
        !liveSpecs.some((spec) => registersTest(spec) && runs(command, spec)),
    )
    .map(([name]) => name);
  expect(vacuous).toEqual([]);
});
