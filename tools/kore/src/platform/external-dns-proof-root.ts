// Docs: docs/decisions/0162-external-dns-publishes-route-records-for-the-external-gateway-behind-external-dns.md
// The throwaway copy the external-dns proof converges from (issue #1617). A detached worktree of HEAD takes
// the place of the checkout, so the tracked local overlay is never edited: only the copy's environment is.
import { join } from "node:path";
import type { Environment } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { throwawayEnvironment } from "./external-dns-proof.js";

/** The file access the copy needs: reading and writing the environment inside the throwaway worktree. */
export interface ProofRootFiles {
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
}

export interface ProofRootOptions {
  /** The checkout the proof is run from; git adds the worktree from here. */
  root: string;
  /** A directory that does not exist yet; it becomes the throwaway copy. */
  dest: string;
  runner: Runner;
  files: ProofRootFiles;
}

/**
 * Makes the throwaway copy: a detached worktree of HEAD at `dest`, whose local environment turns the proof
 * flags on and names the proof domain. Returns the copy's path. Run `KORE_ROOT=<dest> kore local up` from it,
 * then the live test with the same KORE_ROOT. Nothing is written into `root`. A git refusal names the fix.
 */
export async function prepareProofRoot(
  options: ProofRootOptions,
): Promise<string> {
  const { root, dest, runner, files } = options;
  const added = await runner.run(
    "git",
    ["worktree", "add", "--detach", dest, "HEAD"],
    { cwd: root, capture: true },
  );
  if (added.code !== 0) {
    throw new Error(
      `the throwaway copy could not be made at ${dest}: ${added.stderr.trim() || "git worktree add failed"}. Choose a directory that does not exist, or remove an old copy with git worktree remove`,
    );
  }
  const path = join(dest, "infra/environments/local/environment.yaml");
  const environment = JSON.parse(
    await files.read(path),
  ) as unknown as Environment;
  await files.write(
    path,
    `${JSON.stringify(throwawayEnvironment(environment), null, 2)}\n`,
  );
  return dest;
}
