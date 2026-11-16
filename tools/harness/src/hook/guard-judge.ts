// The guard's verdict on one recorded call, as a ref's own built bundle gives it: `hook guard`
// reads a PreToolUse payload on stdin, exits 2 with the refusal on stderr, and prints a warning as
// JSON. The recorded paths move into the replay worktree first, so the guard judges them against
// the ref's tree. The payload names no session, so the guard records nothing to the ledger.

import type { Runner, RunResult } from "../runtime/index.js";
import { CommandError } from "../runtime/index.js";
import type { Judge, Judged, WindowCall } from "./guard-replay.js";

/** The guard could not give a verdict: the message says what happened. */
export class GuardJudgeError extends CommandError {}

/** Where recorded paths came from, and where the replay worktree is. */
export interface ReplayPaths {
  /** The checkouts whose recorded paths belong to this repository. */
  from: readonly string[];
  /** The replay worktree the paths move into. */
  to: string;
}

// A path inside any worktree of the repository, by the worktree's own name.
const WORKTREE_PATH = /^(.*?)\/\.claude\/worktrees\/[^/]+(\/.*)?$/;
const RULE_TAG = /\[guard:([^\]]+)\]/;

const ruleIn = (text: string): string => RULE_TAG.exec(text)?.[1] ?? "";

/**
 * Moves a recorded path into the replay worktree: a path inside any worktree of the repository
 * moves by its worktree's name, one under a checkout in `from` by its root. Any other path stays.
 */
export function relocate(
  path: string,
  from: readonly string[],
  to: string,
): string {
  const worktree = WORKTREE_PATH.exec(path);
  if (worktree !== null) {
    return `${to}${worktree[2] ?? ""}`;
  }
  for (const root of from) {
    if (path === root || path.startsWith(`${root}/`)) {
      return `${to}${path.slice(root.length)}`;
    }
  }
  return path;
}

/** The PreToolUse payload the guard reads for one recorded call, with its paths moved. */
export function payloadOf(
  call: WindowCall,
  paths: ReplayPaths,
): Record<string, unknown> {
  const move = (path: string) => relocate(path, paths.from, paths.to);
  const filePath = call.input["file_path"];
  const input =
    typeof filePath === "string"
      ? { ...call.input, file_path: move(filePath) }
      : call.input;
  return { tool_name: call.tool, tool_input: input, cwd: move(call.cwd) };
}

/** The guard's verdict, read from the exit code and output of `hook guard`. */
export function judgedOf(result: RunResult): Judged {
  if (result.code === 0) {
    return result.stdout.includes("additionalContext")
      ? { action: "warn", rule: ruleIn(result.stdout) }
      : { action: "allow" };
  }
  if (result.code === 2) {
    return { action: "block", rule: ruleIn(result.stderr) };
  }
  const first = result.stderr.trim().split("\n")[0] ?? "";
  throw new GuardJudgeError(`the guard exited ${result.code}: ${first}`);
}

/** A judge that runs the bundle's `hook guard` in the replay worktree for each call. */
export function judgeWith(
  runner: Runner,
  bundle: string,
  env: Record<string, string>,
  paths: ReplayPaths,
): Judge {
  return async (call) => {
    const result = await runner.run(
      process.execPath,
      [bundle, "hook", "guard"],
      {
        cwd: paths.to,
        env,
        input: JSON.stringify(payloadOf(call, paths)),
      },
    );
    return judgedOf(result);
  };
}
