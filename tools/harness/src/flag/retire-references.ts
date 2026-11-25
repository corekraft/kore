// Docs: docs/decisions/0149-a-feature-flag-retires-after-it-soaks-on-in-every-environment-it-applies-to.md

import type { Runner } from "../runtime/index.js";
import { FlagError } from "./overlay.js";

/** One place the flag's name is still written in the checkout, for the writer to delete. */
export interface Reference {
  path: string;
  line: number;
  text: string;
}

/** `git grep` exits 1 when nothing matches; any other failure is a search that did not run. */
const NO_MATCH = 1;

/** One `path:line:text` line of git grep output, read on its first two colons so the text keeps its own. */
function referenceOf(line: string): Reference | undefined {
  const match = /^([^:]+):(\d+):(.*)$/.exec(line);
  if (match === null) {
    return undefined;
  }
  return {
    path: match[1] ?? "",
    line: Number(match[2]),
    text: match[3] ?? "",
  };
}

/**
 * Every line of the checkout's tracked files that still names the flag, so a
 * retirement can print what the writer has to delete. The search is a fixed
 * string, and a search that cannot run is refused, never reported as none.
 */
export async function remainingReferences(
  runner: Runner,
  base: string,
  flag: string,
): Promise<Reference[]> {
  const result = await runner.run(
    "git",
    ["grep", "-n", "-F", "-e", flag, "--"],
    { cwd: base },
  );
  if (result.code === NO_MATCH) {
    return [];
  }
  if (result.code !== 0) {
    throw new FlagError(
      `Cannot search the checkout for ${flag}: ${result.stderr.trim() || `git grep exited ${result.code}`}. Fix the checkout, then rerun.`,
    );
  }
  return result.stdout
    .split("\n")
    .filter((line) => line !== "")
    .map(referenceOf)
    .filter((reference): reference is Reference => reference !== undefined);
}
