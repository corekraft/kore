// lint-staged lints and formats staged harness sources with the harness's own
// pinned tools, and leaves unrelated files alone.
// Docs: AGENTS.md

import assert from "node:assert/strict";
import { test } from "node:test";

import config from "../../tools/kore/lint-staged.config.js";

const matches = (glob, file) => {
  const pattern = glob
    .replace(/[.]/g, "\\.")
    .replace(/\*\*\//g, "(.+/)?")
    .replace(/\*/g, "[^/]*")
    .replace(/\{([^}]+)\}/g, (_, alts) => `(${alts.split(",").join("|")})`);
  return new RegExp(`^${pattern}$`).test(file);
};

const commandsFor = (file) =>
  Object.entries(config)
    .filter(([glob]) => matches(glob, file))
    .flatMap(([, commands]) => commands);

test("staged harness sources are linted with the harness oxlint and formatted with its prettier", () => {
  const commands = commandsFor("tools/harness/src/cli/cli.ts");
  assert.ok(
    commands.some(
      (c) =>
        c.startsWith("tools/harness/node_modules/.bin/oxlint ") &&
        c.includes("--deny-warnings"),
    ),
  );
  assert.ok(
    commands.some((c) =>
      c.startsWith("tools/harness/node_modules/.bin/prettier --write"),
    ),
  );
  assert.ok(!commands.some((c) => c.startsWith("tools/kore/")));
});

test("staged harness tests are linted and formatted too", () => {
  assert.ok(commandsFor("tools/harness/tests/a.ts").length >= 2);
});

test("staged harness config files are formatted with the harness prettier", () => {
  const commands = commandsFor("tools/harness/package.json");
  assert.deepEqual(commands, [
    "tools/harness/node_modules/.bin/prettier --write",
  ]);
});

test("kore sources keep their kore tools", () => {
  const commands = commandsFor("tools/kore/src/a.ts");
  assert.ok(commands.every((c) => c.startsWith("tools/kore/")));
});

test("unrelated files run no lint-staged commands", () => {
  assert.deepEqual(commandsFor("README.md"), []);
  assert.deepEqual(commandsFor("skills/bin/harness.mjs"), []);
});
