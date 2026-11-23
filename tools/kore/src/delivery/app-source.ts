import { join } from "node:path";
import { CommandError, type Runner } from "../runtime/index.js";

/** What the eval reads from an application repository. */
export interface AppSource {
  /** The working tree's flags.yaml, or undefined when the file is missing. */
  flagsText(): Promise<string | undefined>;
  /** The base commit's flags.yaml, or undefined when the base has none. */
  baseFlagsText(): Promise<string | undefined>;
  /** The paths changed between the base and HEAD. */
  changedPaths(): Promise<string[]>;
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
      lines(
        await git(runner, dir, base, ["diff", "--name-only", base, "HEAD"]),
      ),
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

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
