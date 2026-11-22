// Runs the installed claude's own --help, so a claude without a flag session exec passes fails here,
// then runs each role session exec starts with the real claude. CI has no claude on PATH, so the specs
// are skipped there, with the reason in their names. Where claude is present, a missing flag, a failed
// --help or a role claude does not load fails the spec.
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { ProcessRunner, nodeFileSystem } from "../src/runtime/index.js";
import {
  PASSED_FLAGS,
  namesFlag,
  readRoleAgent,
} from "../src/session/index.js";

const claudeOnPath = (process.env["PATH"] ?? "")
  .split(delimiter)
  .some((dir) => dir !== "" && existsSync(join(dir, "claude")));

const name = claudeOnPath
  ? "runs the installed claude's --help, which names every flag session exec passes"
  : "runs the installed claude's --help, which names every flag session exec passes (skipped: claude is not on PATH)";

it.skipIf(!claudeOnPath)(name, async () => {
  const help = await new ProcessRunner().run("claude", ["--help"]);

  expect(help.code).toBe(0);
  expect(PASSED_FLAGS.filter((flag) => !namesFlag(help.stdout, flag))).toEqual(
    [],
  );
});

// The main checkout, the root the wrapper reads each role's definition from.
const CHECKOUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

// Each role session exec starts, run by the real claude with the argv the wrapper builds:
// the role's definition as --agents, and --setting-sources user so no project setting loads.
// A claude that does not load the role fails with "not found"; one that loads it answers.
for (const role of ["reader", "writer"]) {
  it.skipIf(!claudeOnPath)(
    `starts the ${role} role from its definition under --setting-sources user, without a not-found error`,
    async () => {
      const definition = await readRoleAgent(
        { fs: nodeFileSystem },
        CHECKOUT,
        role,
      );
      if (!definition.ok) {
        throw new Error(definition.message);
      }

      const result = await new ProcessRunner().run("claude", [
        "--agent",
        role,
        "--agents",
        definition.json,
        "--model",
        "claude-haiku-5-5",
        "--setting-sources",
        "user",
        "-p",
        "Reply with only the word OK.",
      ]);

      expect(result.stdout + result.stderr).not.toMatch(/not found/);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/ok/i);
    },
  );
}
