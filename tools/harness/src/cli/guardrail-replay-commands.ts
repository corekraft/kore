// `guardrail replay`: the recorded calls one guard rule refused under an old git ref and allows
// under a new one, judged by each ref's own built guard. Each ref is checked out in a disposable
// worktree under .claude/worktrees, built there, asked for each call through `hook guard`, and
// removed when the replay ends. It is a developer tool under ADR 0101, not a guard: it reads the
// transcripts and the inventory, never the ledger, and writes nothing outside its worktrees.
// Ideas that change what a guard blocks use it (ADR 0119).

import { homedir } from "node:os";
import { join } from "node:path";
import { GuardrailError, readInventory } from "../guardrail/index.js";
import {
  GuardJudgeError,
  callsInWindow,
  closeReplayWorktree,
  defaultDirs,
  judgeWith,
  markerInstant,
  openReplayWorktree,
  parseTranscript,
  readTranscripts,
  replayRule,
  scrubbed,
  type Judge,
  type Window,
  type WindowCall,
} from "../hook/index.js";
import {
  mainRoot,
  type CliDeps,
  type Command,
  type CommandContext,
} from "../runtime/index.js";
import { replayHelp } from "./guardrail-replay-help.js";

const FAILED = 1;
const USAGE = 2;

const FORM =
  "harness guardrail replay --rule <rule> --old <ref> --new <ref> --since <date|UTC timestamp> [--until <date|UTC timestamp>]";

const REQUIRED = ["rule", "old", "new", "since"] as const;

/** The flags as the command was asked: the rule, both refs, and the window it reads. */
interface Request {
  rule: string;
  old: string;
  new: string;
  window: Window;
}

/** The commits the two refs name. */
interface Commits {
  old: string;
  new: string;
}

/** Prints an error as the command's message, plus a JSON object first under --json. */
function fail({ json, deps }: CommandContext, message: string, code: number) {
  deps.stderr(
    `${json ? `${JSON.stringify({ error: message })}\n` : ""}${message}\n`,
  );
  return code;
}

/** A flag's trimmed text, or "" when it is absent. */
function text(options: CommandContext["options"], key: string): string {
  const value = options[key];
  return typeof value === "string" ? value.trim() : "";
}

const notADate = (value: string, flag: string) =>
  `--${flag} "${value}" is not a date (YYYY-MM-DD) or a UTC timestamp (YYYY-MM-DDTHH:MM:SSZ), in the form of the Last retrospective marker`;

/** The window the flags name: since is required, until is open when absent. */
function windowOf(since: string, until: string): Window | string {
  const start = markerInstant(since);
  if (!Number.isFinite(start)) {
    return notADate(since, "since");
  }
  if (until === "") {
    return { since: start, until: Number.POSITIVE_INFINITY };
  }
  const end = markerInstant(until);
  return Number.isFinite(end)
    ? { since: start, until: end }
    : notADate(until, "until");
}

/** The request the flags name, or the message of the first flag that is missing or wrong. */
function requestOf(
  options: CommandContext["options"],
): Request | { error: string } {
  const missing = REQUIRED.find((name) => text(options, name) === "");
  if (missing !== undefined) {
    return { error: `Missing --${missing}; run \`${FORM}\`.` };
  }
  const window = windowOf(text(options, "since"), text(options, "until"));
  if (typeof window === "string") {
    return { error: window };
  }
  return {
    rule: text(options, "rule"),
    old: text(options, "old"),
    new: text(options, "new"),
    window,
  };
}

const notACommit = (ref: string) =>
  `${ref} is not a commit; name a git ref such as main, or a commit sha`;

/** The commit a ref names, or undefined when the ref names none. */
async function commitOf(
  deps: CliDeps,
  root: string,
  ref: string,
): Promise<string | undefined> {
  const result = await deps.runner.run(
    "git",
    ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    { cwd: root },
  );
  return result.code === 0 ? result.stdout.trim() : undefined;
}

/** The commits both refs name, or the message of the first ref that names none. */
async function commitsOf(
  deps: CliDeps,
  root: string,
  request: Request,
): Promise<Commits | { error: string }> {
  const old = await commitOf(deps, root, request.old);
  if (old === undefined) {
    return { error: notACommit(request.old) };
  }
  const next = await commitOf(deps, root, request.new);
  if (next === undefined) {
    return { error: notACommit(request.new) };
  }
  return { old, new: next };
}

/** The environment git and the build run in: the caller's PATH and HOME, with no GIT_* variable. */
const baseEnv = (deps: CliDeps) =>
  scrubbed({ PATH: deps.env["PATH"], HOME: deps.env["HOME"] });

/**
 * The environment the guard runs in. Its project is the replay worktree, so the ref's own
 * inventory is read; KORE_ROOT names the worktree too, so no real ledger root is reachable.
 */
const guardEnv = (deps: CliDeps, path: string): Record<string, string> => ({
  ...baseEnv(deps),
  CLAUDE_PROJECT_DIR: path,
  KORE_ROOT: path,
});

/** Checks out and builds a ref's worktree, records it for removal, and returns that ref's judge. */
async function openJudge(
  context: CommandContext,
  root: string,
  sha: string,
  from: readonly string[],
  opened: string[],
): Promise<Judge> {
  const { deps } = context;
  const path = await openReplayWorktree(
    deps.runner,
    root,
    sha,
    `replay-${deps.ids.next()}`,
    baseEnv(deps),
  );
  opened.push(path);
  return judgeWith(
    deps.runner,
    join(path, "skills", "bin", "harness.mjs"),
    guardEnv(deps, path),
    { from, to: path },
  );
}

/** The recorded calls in the window, read from the transcripts of this repository. */
async function recordedCalls(
  deps: CliDeps,
  root: string,
  window: Window,
): Promise<WindowCall[]> {
  const home = deps.env["HOME"] || homedir();
  const dirs = await defaultDirs(deps.fs, deps.runner, root, home);
  const transcripts = (await readTranscripts(deps.fs, dirs)).map((session) =>
    parseTranscript(session.id, session.text),
  );
  return callsInWindow(transcripts, window, root);
}

/** Opens both refs' worktrees, judges the window's calls under each, and prints the report. */
async function replayOpened(
  context: CommandContext,
  request: Request,
  root: string,
  commits: Commits,
  opened: string[],
): Promise<number> {
  const { deps } = context;
  const from = [...new Set([root, (await mainRoot(deps)) ?? root])];
  const before = await openJudge(context, root, commits.old, from, opened);
  const after = await openJudge(context, root, commits.new, from, opened);
  const report = await replayRule({
    rule: request.rule,
    calls: await recordedCalls(deps, root, request.window),
    before,
    after,
  });
  const iso = (ms: number) =>
    Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  deps.stdout(
    `${JSON.stringify(
      {
        old: commits.old,
        new: commits.new,
        since: iso(request.window.since),
        until: iso(request.window.until),
        ...report,
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

/** Removes every worktree the replay opened; returns the messages of those git could not remove. */
async function closeAll(
  deps: CliDeps,
  root: string,
  paths: readonly string[],
): Promise<string[]> {
  const problems: string[] = [];
  for (const path of paths) {
    try {
      await closeReplayWorktree(deps.runner, root, path, baseEnv(deps));
    } catch (error) {
      if (!(error instanceof GuardJudgeError)) {
        throw error;
      }
      problems.push(error.message);
    }
  }
  return problems;
}

/**
 * Runs the replay and then removes its worktrees, whatever happened: a failed ref, a broken build
 * or a refusal to answer all leave no worktree behind, and a worktree git cannot remove is named.
 */
async function replayWith(
  context: CommandContext,
  request: Request,
  root: string,
  commits: Commits,
): Promise<number> {
  const { deps } = context;
  const opened: string[] = [];
  let code: number;
  try {
    code = await replayOpened(context, request, root, commits, opened);
  } catch (error) {
    if (!(error instanceof GuardJudgeError)) {
      throw error;
    }
    code = fail(context, error.message, FAILED);
  }
  const leftBehind = await closeAll(deps, root, opened);
  for (const message of leftBehind) {
    deps.stderr(`${message}\n`);
  }
  return leftBehind.length > 0 ? FAILED : code;
}

export const guardrailReplay: Command = {
  help: replayHelp,
  summary:
    "read-only; list the recorded Bash, Read, Write and Edit calls in a window that the rule refused under the old git ref and the new ref's guard allows, as JSON (rule, old, new, since, until, examined, empty, changed: session, line, at, tool, command or path); each ref's own guard judges each call in a disposable worktree under .claude/worktrees, built there and removed afterwards; an empty list is stated as empty; it reads session transcripts and the guardrail inventory, never the ledger, and writes nothing outside those worktrees; the guard-idea checklist: (1) the guard corpus still blocks every known-bad case in CI (integration/hook/guard-corpus.spec.ts); (2) run this over the idea's window; (3) a reader pane checks the changed list and the judge reads its report; (4) one changed command that left the worktree or wrote outside its role refutes the idea, whatever the block count says; (5) the revert restores the approved state, and the escape joins CORPUS in guard-corpus.ts in the reverting change, with the revert and the escape in the next owner digest (--rule <name> --old <ref> --new <ref> --since <date|UTC timestamp> [--until <date|UTC timestamp>]; the output is always JSON)",
  options: {
    rule: "string",
    old: "string",
    new: "string",
    since: "string",
    until: "string",
  },
  async run(context) {
    const { deps } = context;
    const request = requestOf(context.options);
    if ("error" in request) {
      return fail(context, request.error, USAGE);
    }
    const root = await deps.root();
    let inventory;
    try {
      inventory = await readInventory((path) => deps.fs.readFile(path), root);
    } catch (error) {
      if (!(error instanceof GuardrailError)) {
        throw error;
      }
      return fail(context, error.message, FAILED);
    }
    if (!inventory.guardrails.some((g) => g.rule === request.rule)) {
      const names = inventory.guardrails.map((g) => g.rule).join(", ");
      return fail(
        context,
        `${request.rule} is not a guardrail rule; the inventory names ${names}`,
        USAGE,
      );
    }
    const commits = await commitsOf(deps, root, request);
    if ("error" in commits) {
      return fail(context, commits.error, USAGE);
    }
    return await replayWith(context, request, root, commits);
  },
};
