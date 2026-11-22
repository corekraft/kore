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

// Code Mode is the REPL tool (#1872). claude has no flag for it, so session exec turns it off with the environment
// switch: an off there overrides the user settings' env block, which sets the switch on. claude -p prints its tool
// names as one comma-separated line, after a warning line when Code Mode is off.
const CODE_MODE = "CLAUDE_CODE_EXPERIMENTAL_CODE_MODE";
const SETTINGS_ON = JSON.stringify({ env: { [CODE_MODE]: "1" } });

/** The tool names claude -p reports, with the switch set by env on top of the caller's environment and the settings' switch on. */
async function reportedTools(
  env: Record<string, string>,
): Promise<{ code: number; names: string[] }> {
  // The probe starts its own claude, so the CLAUDECODE marker of an enclosing session is not passed on.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        entry[0] !== CODE_MODE &&
        entry[0] !== "CLAUDECODE",
    ),
  );
  const result = await new ProcessRunner().run(
    "claude",
    [
      "--model",
      "claude-haiku-5-5",
      "--setting-sources",
      "user",
      "--settings",
      SETTINGS_ON,
      "-p",
      "List only the exact names of the tools you can call, comma separated.",
      "--output-format",
      "json",
    ],
    { env: { ...inherited, ...env } },
  );
  const reply = JSON.parse(
    result.stdout.slice(result.stdout.search(/^\{/m)),
  ) as { result: string };
  return {
    code: result.code,
    names: reply.result
      .replace(/\.$/, "")
      .split(",")
      .map((tool) => tool.trim()),
  };
}

const named = (label: string) =>
  claudeOnPath ? label : `${label} (skipped: claude is not on PATH)`;

it.skipIf(!claudeOnPath)(
  named(
    "with Code Mode off in the environment, claude lists Bash and no REPL, though the settings turn it on",
  ),
  async () => {
    const { code, names } = await reportedTools({ [CODE_MODE]: "0" });

    expect(code).toBe(0);
    expect(names).toContain("Bash");
    expect(names).not.toContain("REPL");
  },
);

it.skipIf(!claudeOnPath)(
  named(
    "the control: with the switch unset and the settings on, claude lists REPL",
  ),
  async () => {
    const { code, names } = await reportedTools({});

    expect(code).toBe(0);
    expect(names).toContain("REPL");
  },
);
