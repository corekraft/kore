/**
 * The environment for a git or npm child process in a test, without any `GIT_*`
 * variable. A git hook exports GIT_DIR, GIT_INDEX_FILE and friends; inherited,
 * they point a fixture's git commands at the real repository.
 */
export function cleanGitEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !key.startsWith("GIT_")),
  );
}
