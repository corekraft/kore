export type Freshness =
  { state: "current" } | { state: "behind" | "unknown"; message: string };

const CHANGED_HARNESS_FILES =
  '[.files[].filename | select(startswith("tools/harness/"))] | length';

/**
 * Compares the commit the harness bundle was built at with origin/main, through GitHub
 * (the judge cannot fetch). Behind means main changed a file under tools/harness since.
 * When the comparison is impossible the result is unknown, never behind.
 */
export async function harnessFreshness(
  api: (args: readonly string[]) => Promise<string>,
  repo: string,
  stamp: string | undefined,
): Promise<Freshness> {
  if (stamp === undefined) {
    return {
      state: "unknown",
      message:
        "The harness bundle has no commit stamp, so it cannot be compared with origin/main. Rebuild it with `mise run harness-build`.",
    };
  }
  let out: string;
  try {
    out = await api([
      "api",
      `repos/${repo}/compare/${stamp}...main`,
      "--jq",
      CHANGED_HARNESS_FILES,
    ]);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return {
      state: "unknown",
      message: `Could not compare the harness bundle (${stamp}) with origin/main: ${why}. Continuing without the freshness check.`,
    };
  }
  const changed = Number(out.trim());
  if (out.trim() === "" || !Number.isInteger(changed)) {
    return {
      state: "unknown",
      message: `GitHub's comparison of the harness bundle (${stamp}) with origin/main was unreadable. Continuing without the freshness check.`,
    };
  }
  return changed === 0
    ? { state: "current" }
    : {
        state: "behind",
        message: `The harness bundle (built at ${stamp}) is behind origin/main: ${changed} files under tools/harness changed since. Update this worktree to origin/main, run \`mise run harness-build\`, then rerun the precheck.`,
      };
}
