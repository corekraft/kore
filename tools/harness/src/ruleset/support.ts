import { GuardrailError } from "../guardrail/index.js";
import type { CommandContext } from "../runtime/index.js";
import { RulesetError } from "./declared.js";

const FAILED = 1;

/** Reports an expected ruleset or inventory error as one line (or one json object) on stderr. */
export async function guarded(
  { json, deps }: CommandContext,
  action: () => Promise<number>,
): Promise<number> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof RulesetError || error instanceof GuardrailError)) {
      throw error;
    }
    deps.stderr(
      json
        ? `${JSON.stringify({ error: error.message })}\n`
        : `${error.message}\n`,
    );
    return FAILED;
  }
}

function required(context: CommandContext, key: string, meaning: string) {
  const value = context.options[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new RulesetError(
      `Missing --${key}: a ruleset change names its ${meaning} explicitly, never a default. Rerun with --${key} <value>.`,
    );
  }
  return value.trim();
}

/** The repository (the environment) and the ruleset name (the target) a command acts on. */
export function destination(context: CommandContext) {
  return {
    repo: required(
      context,
      "repo",
      "repository, as owner/name, the environment",
    ),
    target: required(context, "target", "ruleset, by name, the target"),
  };
}
