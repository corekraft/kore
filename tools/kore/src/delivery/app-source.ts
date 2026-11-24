import { join } from "node:path";
import { CommandError, type Runner } from "../runtime/index.js";

/** One path changed between the base and HEAD, with git's status letter for it. */
export interface AppChange {
  /** A added, M modified, D deleted, T type changed. Renames are shown as a delete and an add. */
  status: string;
  path: string;
}

/** What the eval reads from an application repository. */
export interface AppSource {
  /** The working tree's flags.yaml, or undefined when the file is missing. */
  flagsText(): Promise<string | undefined>;
  /** The base commit's flags.yaml, or undefined when the base has none. */
  baseFlagsText(): Promise<string | undefined>;
  /** The paths changed between the base and HEAD. */
  changedPaths(): Promise<string[]>;
  /** The paths changed between the base and HEAD, each with its git status. */
  changes(): Promise<AppChange[]>;
  /** A file's text at HEAD. */
  headText(path: string): Promise<string>;
  /** The full message of the head commit. */
  headMessage(): Promise<string>;
}

export interface GitAppSourceOptions {
  runner: Runner;
  dir: string;
  base: string;
  /** Reads a file, or resolves undefined when it does not exist. */
  readText: (path: string) => Promise<string | undefined>;
}

/** Reads an application repository with git, through the injected runner only. */
export function gitAppSource(options: GitAppSourceOptions): AppSource {
  const { runner, dir, base } = options;
  return {
    flagsText: () => options.readText(join(dir, "flags.yaml")),
    baseFlagsText: () => showOrUndefined(runner, dir, `${base}:flags.yaml`),
    changedPaths: async () =>
      nulFields(
        await git(runner, dir, base, [
          "diff",
          "--name-only",
          "-z",
          base,
          "HEAD",
        ]),
      ),
    changes: async () =>
      statusPairs(
        await git(runner, dir, base, [
          "diff",
          "--name-status",
          "-z",
          "--no-renames",
          base,
          "HEAD",
        ]),
      ),
    headText: (path) => headText(runner, dir, path),
    headMessage: () =>
      git(runner, dir, base, ["log", "-1", "--format=%B", "HEAD"]),
  };
}

async function git(
  runner: Runner,
  dir: string,
  base: string,
  args: string[],
): Promise<string> {
  try {
    const result = await runner.run("git", ["-C", dir, ...args]);
    return result.stdout;
  } catch (error) {
    if (!(error instanceof CommandError)) {
      throw error;
    }
    throw new Error(
      `eval could not read ${dir} with git (${args.join(" ")}): ${error.result.stderr.trim()}; check that --base ${base} names a commit in that repository`,
    );
  }
}

/** A file's text at HEAD. Git cannot read a path that is not in HEAD, which is named in the error. */
async function headText(
  runner: Runner,
  dir: string,
  path: string,
): Promise<string> {
  try {
    const result = await runner.run("git", ["-C", dir, "show", `HEAD:${path}`]);
    return result.stdout;
  } catch (error) {
    if (!(error instanceof CommandError)) {
      throw error;
    }
    throw new Error(
      `eval could not read ${path} at HEAD with git: ${error.result.stderr.trim()}`,
    );
  }
}

/** A file at a git revision, or undefined when git reports that it is not there. */
async function showOrUndefined(
  runner: Runner,
  dir: string,
  revisionPath: string,
): Promise<string | undefined> {
  try {
    const result = await runner.run("git", ["-C", dir, "show", revisionPath]);
    return result.stdout;
  } catch (error) {
    if (error instanceof CommandError) {
      return undefined;
    }
    throw error;
  }
}

/** The NUL-terminated names git prints with -z; a name is never quoted, so it is read as is. */
function nulFields(text: string): string[] {
  return text.split("\0").filter((field) => field !== "");
}

/** The status and path pairs of `git diff --name-status -z`, each status followed by its path. */
function statusPairs(text: string): AppChange[] {
  const fields = nulFields(text);
  const changes: AppChange[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    changes.push({
      status: fields[index] ?? "",
      path: fields[index + 1] ?? "",
    });
  }
  return changes;
}
