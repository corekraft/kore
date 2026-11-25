import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (the handover values)

/** Runs git in the repository and returns its trimmed output. */
export async function git(
  repository: Repository,
  runner: Runner,
  args: string[],
): Promise<string> {
  const { stdout } = await runner.run("git", args, {
    cwd: repository.root,
    capture: true,
  });
  return stdout.trim();
}

/**
 * The Kore repository's https URL, read from its git origin. Every command that
 * composes a value from it reads it here, so a read-only render and an install see
 * the same URL. `needed` completes the refusal: "which <needed>; set origin to ..."
 */
export async function koreRepositoryURL(
  repository: Repository,
  runner: Runner,
  needed: string,
): Promise<string> {
  const repoURL = await git(repository, runner, [
    "remote",
    "get-url",
    "origin",
  ]);
  if (!repoURL.startsWith("https://")) {
    throw new Error(
      `the git origin ${repoURL} is not an https URL, which ${needed}; set origin to the https URL of the repository`,
    );
  }
  return repoURL;
}
