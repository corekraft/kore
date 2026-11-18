// Finding the transcript the prompt-size command reads (#1038). With no name, the newest
// transcript in this checkout's own Claude project directory, found the way the context hook's
// session count finds it. With a Claude session id, that id's transcript in one of the
// repository's own transcript directories (the main checkout and its worktrees); a session
// outside them is refused. Nothing is written, and no transcript path is taken from the caller.

import { homedir } from "node:os";
import { join } from "node:path";
import { defaultDirs } from "./retro-transcripts.js";
import type { CliDeps } from "../runtime/index.js";

/** A located transcript: its Claude session id and its text, or the actionable reason it was not found. */
export type Located = { session: string; text: string } | { error: string };

/** What the lookups read: the file system, the runner for git, and the environment. */
export type LocateDeps = Pick<CliDeps, "fs" | "runner" | "env">;

const JSONL = ".jsonl";

const NO_DEFAULT = (dir: string) =>
  `No session transcript for this checkout yet: none in ${dir}. Run this from a Claude session of this checkout, or name a session by its Claude session id: harness session prompt-size <session-id>.`;

const NAMED_MISSING = (session: string) =>
  `Session ${session} is not a session of this repository: no ${session}.jsonl in its Claude session directories (the main checkout and its worktrees). Name a session by its Claude session id, or run the command with no name for this checkout's newest session.`;

const isMissing = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

/** This checkout's own Claude project directory: the one the context hook counts sessions in. */
function projectDirOf(deps: LocateDeps, root: string): string {
  const config = deps.env["CLAUDE_CONFIG_DIR"] || join(homedir(), ".claude");
  return join(config, "projects", root.replace(/[^a-zA-Z0-9]/g, "-"));
}

/** The newest transcript of this checkout by modification time, or the reason there is none. */
export async function locateDefault(
  deps: LocateDeps,
  root: string,
): Promise<Located> {
  const dir = projectDirOf(deps, root);
  let names: string[];
  try {
    names = (await deps.fs.readdir(dir)).filter((n) => n.endsWith(JSONL));
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
    names = [];
  }
  let newest: { name: string; mtime: number } | undefined;
  for (const name of names) {
    const mtime = await deps.fs.mtimeMs(join(dir, name));
    if (newest === undefined || mtime > newest.mtime) {
      newest = { name, mtime };
    }
  }
  if (newest === undefined) {
    return { error: NO_DEFAULT(dir) };
  }
  return {
    session: newest.name.slice(0, -JSONL.length),
    text: await deps.fs.readFile(join(dir, newest.name)),
  };
}

/** The transcript of a Claude session id in the repository's own transcript directories, or a refusal. */
export async function locateNamed(
  deps: LocateDeps,
  root: string,
  session: string,
): Promise<Located> {
  const dirs = await defaultDirs(
    deps.fs,
    deps.runner,
    root,
    deps.env["HOME"] || homedir(),
  );
  for (const dir of dirs) {
    const file = join(dir, `${session}${JSONL}`);
    if (await deps.fs.exists(file)) {
      return { session, text: await deps.fs.readFile(file) };
    }
  }
  return { error: NAMED_MISSING(session) };
}
