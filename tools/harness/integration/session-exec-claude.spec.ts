// Runs the installed claude's own --help, so a claude without a flag session exec passes fails here.
// CI has no claude on PATH, so the spec is skipped there, with the reason in its name. Where claude
// is present, a missing flag or a failed --help fails the spec.
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { expect, it } from "vitest";
import { ProcessRunner } from "../src/runtime/index.js";
import { PASSED_FLAGS, namesFlag } from "../src/session/index.js";

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
