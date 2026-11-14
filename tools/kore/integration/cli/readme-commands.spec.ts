import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "vitest";
import { COMMANDS } from "../../src/cli/commands.js";

// The README's Commands section names every command in the command table, so a
// reader can find each one. Removing a row fails the test naming that command.

const readme = readFileSync(
  new URL("../../../../README.md", import.meta.url),
  "utf8",
);

/** The text from the "## Commands" heading to the next level-two heading. */
function commandsSection(markdown: string): string {
  const start = markdown.indexOf("\n## Commands\n");
  assert.notEqual(start, -1, "README.md has no ## Commands section");
  const rest = markdown.slice(start + "\n## Commands\n".length);
  const next = rest.indexOf("\n## ");
  return next === -1 ? rest : rest.slice(0, next);
}

const section = commandsSection(readme);

describe("README Commands section", () => {
  test.each([...COMMANDS.keys()])(
    "the README Commands section names kore %s",
    (name) => {
      assert.ok(
        section.includes(`\`kore ${name}\``),
        `kore ${name} is missing from the README Commands section`,
      );
    },
  );
});
