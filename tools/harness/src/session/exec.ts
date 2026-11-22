import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command, CliDeps, Runner } from "../runtime/index.js";
import { bundleMainRoot } from "../runtime/index.js";
import { hasIdentity, roleToken } from "./role-token.js";

/** One session's launch: the role, its model and effort, and the brief that is claude's first prompt. */
export interface LaunchInput {
  readonly role: string;
  readonly model: string;
  readonly effort: string;
  readonly brief: string;
}

/** The claude flags this wrapper passes. Each must appear in `claude --help`, or the wrapper refuses to start. */
export const PASSED_FLAGS = [
  "--agent",
  "--model",
  "--effort",
  "--permission-mode",
  "--setting-sources",
  "--settings",
] as const;

/** roleToken's messages end with the pane wording; a terminal has no pane to split. */
const PANE_SUFFIX = / No pane was split\.$/;

const BUNDLE_HINT =
  "Start it by absolute path from the main checkout's skills/bin/harness.mjs, then rerun.";

/** The caller's environment without any GitHub token, and without any herdr variable an hc terminal inherits from the core. */
function scrubbed(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        entry[0] !== "GH_TOKEN" &&
        entry[0] !== "GITHUB_TOKEN" &&
        !entry[0].startsWith("HERDR_"),
    ),
  );
}

/** Whether `claude --help` names the flag: as a whole token, or with a value after `=`, so --settings is not --setting-sources. */
export const namesFlag = (help: string, flag: string): boolean =>
  help
    .split(/[\s,|[\]()<>]+/)
    .some((token) => token === flag || token.startsWith(`${flag}=`));

/** A runner whose calls get the scrubbed environment unless the call names its own, so the token helpers never inherit a GitHub token. */
function withEnv(runner: Runner, env: Record<string, string>): Runner {
  return {
    run: (command, args, options = {}) =>
      runner.run(command, args, { ...options, env: options.env ?? env }),
  };
}

/** Why this bundle may not start the session, or undefined when it is the main checkout's own. */
function bundleRefusal(bundleUrl: string, main: string): string | undefined {
  const checkout = resolve(dirname(fileURLToPath(bundleUrl)), "../..");
  return checkout === main
    ? undefined
    : `session exec refuses to run from the bundle at ${checkout}, which is not the main checkout ${main}. ${BUNDLE_HINT}\n`;
}

/** Why claude cannot be started, or undefined when `claude --help` names every flag the wrapper passes. */
async function claudeRefusal(
  deps: CliDeps,
  env: Record<string, string>,
): Promise<string | undefined> {
  const help = await deps.runner.run("claude", ["--help"], { env });
  if (help.code !== 0) {
    return "Could not run `claude --help`, so session exec cannot check claude's flags. Install claude, then rerun.\n";
  }
  const missing = PASSED_FLAGS.filter((flag) => !namesFlag(help.stdout, flag));
  return missing.length === 0
    ? undefined
    : `The installed claude lacks ${missing.join(", ")}, which session exec passes. Upgrade claude, then rerun.\n`;
}

/** The role's token outcome: ok with its token (none for a role with no identity), or a refusal to print. */
type TokenOutcome =
  | { readonly ok: true; readonly token?: string }
  | { readonly ok: false; readonly message: string };

/** The role's token, minted or read from the main checkout's identity store with every call scrubbed. */
async function tokenFor(
  deps: CliDeps,
  main: string,
  env: Record<string, string>,
  role: string,
): Promise<TokenOutcome> {
  const minted = await roleToken(
    {
      ...deps,
      root: () => Promise.resolve(main),
      runner: withEnv(deps.runner, env),
    },
    role,
  );
  if (minted === undefined) {
    return hasIdentity(role)
      ? {
          ok: false,
          message: `The ${role} role needs its GitHub identity, but no token was minted: the role-tokens flag is off in the local overlay of the main checkout. Turn it on, then rerun. Nothing was started.\n`,
        }
      : { ok: true };
  }
  return "error" in minted
    ? { ok: false, message: `${minted.error.replace(PANE_SUFFIX, "")}\n` }
    : { ok: true, token: minted.token };
}

/**
 * Starts claude as one role's session, in place of the wrapper: refuses unless the
 * bundle is the main checkout's own and claude names every flag it passes, gets the
 * role's token from the main checkout's identity store, and runs claude with only that
 * token and the main bundle added to the scrubbed environment. Returns claude's exit code.
 */
export async function launchClaude(
  deps: CliDeps,
  input: LaunchInput,
): Promise<number> {
  const main = await bundleMainRoot(deps);
  const refusal =
    deps.bundleUrl === undefined || main === undefined
      ? `session exec cannot find the main checkout's bundle. ${BUNDLE_HINT}\n`
      : bundleRefusal(deps.bundleUrl, main);
  if (refusal !== undefined || main === undefined) {
    deps.stderr(refusal ?? "");
    return 1;
  }
  const env = scrubbed(deps.env);
  const flagRefusal = await claudeRefusal(deps, env);
  if (flagRefusal !== undefined) {
    deps.stderr(flagRefusal);
    return 1;
  }
  const token = await tokenFor(deps, main, env, input.role);
  if (!token.ok) {
    deps.stderr(token.message);
    return 1;
  }
  const result = await deps.runner.run(
    "claude",
    [
      "--agent",
      input.role,
      "--model",
      input.model,
      "--effort",
      input.effort,
      "--permission-mode",
      "bypassPermissions",
      "--setting-sources",
      "user",
      "--settings",
      join(main, ".claude", "settings.json"),
      input.brief,
    ],
    {
      env: {
        ...env,
        KORE_HARNESS_BUNDLE: join(main, "skills", "bin", "harness.mjs"),
        ...(token.token === undefined ? {} : { GH_TOKEN: token.token }),
      },
      inherit: true,
    },
  );
  if (result.stderr !== "") {
    deps.stderr(`claude could not start: ${result.stderr}\n`);
  }
  return result.code;
}

const USAGE =
  "session exec needs --role, --model and --effort, and one brief operand. Rerun with all of them.\n";

export const execCommand: Command = {
  summary:
    "start one role's claude session as the wrapper for an hc terminal (`session exec --role <role> --model <model> --effort <effort> <brief>`): run from the main checkout's bundle only, it checks that `claude --help` names every flag it passes, mints the role's token from the identity store with any inherited GitHub token and herdr variable scrubbed, and runs claude in place with the fixed argv and the brief as its first prompt",
  operand: "brief",
  options: { role: "string", model: "string", effort: "string" },
  async run({ options, operand, deps }) {
    const { role, model, effort } = options;
    if (
      typeof role !== "string" ||
      typeof model !== "string" ||
      typeof effort !== "string" ||
      operand === undefined ||
      operand === ""
    ) {
      deps.stderr(USAGE);
      return 1;
    }
    return await launchClaude(deps, { role, model, effort, brief: operand });
  },
};
