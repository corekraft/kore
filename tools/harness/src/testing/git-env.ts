/**
 * The environment for a git, npm or hook child process in a test, without any
 * `GIT_*` variable and without unset entries. A git hook exports GIT_DIR,
 * GIT_WORK_TREE, GIT_INDEX_FILE, GIT_COMMON_DIR and GIT_PREFIX; inherited, they
 * point a fixture's git commands (or a process that runs git) at the real
 * repository and can rewrite its config.
 */
export function cleanGitEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !entry[0].startsWith("GIT_"),
    ),
  );
}
