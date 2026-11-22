import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command, CliDeps, Runner } from "../runtime/index.js";
import { bundleMainRoot } from "../runtime/index.js";
import { readRoleAgent } from "./exec-agent.js";
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
  "--agents",
  "--model",
  "--effort",
  "--permission-mode",
  "--setting-sources",
  "--settings",
] as const;

/**
 * The environment switch that turns Code Mode off. A 0 in the launched process's environment is an
 * off that claude reports before it reads the user settings' env block, which sets the switch to 1.
 */
export const CODE_MODE_SWITCH = "CLAUDE_CODE_EXPERIMENTAL_CODE_MODE";
/** The value that turns Code Mode off, so the role's session runs the Bash tool the role guard reads. */
const CODE_MODE_OFF = "0";
/** The oldest claude session exec accepts: 2.1.330, the only version tested (kore-agents). The Mac's 2.1.329 must update before hc-sessions is on. */
const MIN_CLAUDE = [2, 1, 330] as const;

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

/** claude's version parts from `claude --version`'s first line, or undefined when it prints none. */
export function claudeVersion(output: string): readonly number[] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)\b/.exec(output.trim());
  return match === null ? undefined : match.slice(1).map(Number);
}

/** Whether a version is at least the floor, comparing each part as a number, so 2.1.1000 is above 2.1.330. */
function atLeast(
  version: readonly number[],
  floor: readonly number[],
): boolean {
  const gap = floor
    .map((part, index) => (version[index] ?? 0) - part)
    .find((difference) => difference !== 0);
  return gap === undefined || gap > 0;
}

/** Why this claude cannot turn Code Mode off, or undefined when its version reaches the minimum that can. */
async function versionRefusal(
  deps: CliDeps,
  env: Record<string, string>,
): Promise<string | undefined> {
  const probe = await deps.runner.run("claude", ["--version"], { env });
  const version = probe.code === 0 ? claudeVersion(probe.stdout) : undefined;
  const floor = MIN_CLAUDE.join(".");
  if (version === undefined) {
    return `session exec cannot read claude's version, so it cannot check that claude turns Code Mode off with ${CODE_MODE_SWITCH}=0. Install claude ${floor} or later, then rerun.\n`;
  }
  return atLeast(version, MIN_CLAUDE)
    ? undefined
    : `The installed claude is ${version.join(".")}, but session exec turns Code Mode off with ${CODE_MODE_SWITCH}=0, which needs claude ${floor} or later. Upgrade claude, then rerun.\n`;
}

/** Why claude cannot be started, or undefined when `claude --help` names every flag the wrapper passes and its version can turn Code Mode off. */
async function claudeRefusal(
  deps: CliDeps,
  env: Record<string, string>,
): Promise<string | undefined> {
  const help = await deps.runner.run("claude", ["--help"], { env });
  if (help.code !== 0) {
    return "Could not run `claude --help`, so session exec cannot check claude's flags. Install claude, then rerun.\n";
  }
  const missing = PASSED_FLAGS.filter((flag) => !namesFlag(help.stdout, flag));
  if (missing.length > 0) {
    return `The installed claude lacks ${missing.join(", ")}, which session exec passes. Upgrade claude, then rerun.\n`;
  }
  return versionRefusal(deps, env);
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
 * bundle is the main checkout's own and claude names every flag it passes and is at least 2.1.330, gets the
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
  const definition = await readRoleAgent(deps, main, input.role);
  if (!definition.ok) {
    deps.stderr(definition.message);
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
      "--agents",
      definition.json,
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
        [CODE_MODE_SWITCH]: CODE_MODE_OFF,
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
    "start one role's claude session as the wrapper for an hc terminal (`session exec --role <role> --model <model> --effort <effort> <brief>`): run from the main checkout's bundle only, it reads the role's agent definition from the main checkout as --agents, checks that `claude --help` names every flag it passes and that claude is at least 2.1.330, mints the role's token from the identity store with any inherited GitHub token and herdr variable scrubbed, and runs claude in place with Code Mode off, the fixed argv and the brief as its first prompt",
  operand: "brief",
  options: { role: "string", model: "string", effort: "string" },
  help: {
    purpose:
      "Starts one role's claude session as the wrapper for an hc terminal. It reads the role's agent definition from the main checkout's .claude/agents/<role>.md and passes it as --agents, since --setting-sources user loads no project agent; a role with no definition, or one with no description, is refused. It checks that the installed claude names every flag the wrapper passes and is at least 2.1.330, the oldest that turns Code Mode off with CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=0, and mints the role's GitHub token from the main checkout's identity store with any inherited GitHub token and herdr variable scrubbed, and runs claude with Code Mode off (CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=0), the fixed argv and the brief as its first prompt.",
    when: "When an hc terminal starts a role's session and needs the command that launches it, run from the main checkout's skills/bin/harness.mjs by absolute path.",
    whenNot:
      "When starting a role's session in a herdr pane from the main session: run session spawn, which starts the pane and records the launch. To read the model and effort a role launches at, run session tier.",
    flags: {
      role: "The role whose agent definition claude starts with, such as writer; the role's GitHub identity is minted for the session when it has one.",
      model:
        "The claude model the session runs on, passed as --model; required.",
      effort:
        "The effort level the session runs at, passed as --effort, such as medium or high; required.",
    },
    operand:
      "The brief claude receives as its first prompt; one non-empty argument, quoted when it has spaces.",
    examples: [
      {
        command:
          'harness session exec --role writer --model claude-haiku-5-5 --effort medium "Work the brief for issue 1773"',
        shows:
          "claude starts as the writer role on the model and effort named, with the brief as its first prompt",
      },
      {
        command:
          "harness session exec --role writer --model claude-haiku-5-5 --effort medium",
        shows:
          "the brief is missing, so the usage line prints and the command exits 1 without starting claude",
      },
    ],
    exits: [
      {
        code: 0,
        meaning:
          "claude ran and exited 0; any other code is claude's own exit code, passed through",
      },
      {
        code: 1,
        meaning:
          "refused before claude started: a flag or the brief is missing, the bundle is not the main checkout's, claude is absent, lacks a flag the wrapper passes, is older than 2.1.330 or reports no version, or the role's token could not be minted; stderr names the fix",
      },
    ],
    effects: {
      kind: "mutates",
      detail:
        "the wrapper writes no file: it reads the identity store, mints the role's token, then runs claude as a child process, which may change files, pull requests and issues within the role's GitHub grant",
    },
    seeAlso: ["session spawn", "session tier", "session check"],
  },
  async run({ options, operand, deps }) {
    const { role, model, effort } = options;
    if (
      typeof role !== "string" ||
      role === "" ||
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
