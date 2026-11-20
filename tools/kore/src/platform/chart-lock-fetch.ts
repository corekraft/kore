import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandError, type Runner } from "../runtime/index.js";

// Docs: docs/decisions/0138-publish-signed-configuration-charts-from-main-for-local-proofs.md (the main chart lock and its artifact)

const prefix = "main chart lock:";
const lockFile = "platform-charts.lock.json";

/** The lock fetched for one commit: where it was written, and which artifact and run it came from. */
export interface MainChartLock {
  commit: string;
  path: string;
  artifact: string;
  runId: number;
}

interface ArtifactRecord {
  name: string;
  expired: boolean;
  created_at: string;
  expires_at: string;
  workflow_run: { id: number };
}

/** The commit a ref names in this checkout, as its full sha; a ref it does not name is refused. */
async function commitOf(
  root: string,
  runner: Runner,
  ref: string,
): Promise<string> {
  try {
    const { stdout } = await runner.run(
      "git",
      ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
      { cwd: root, capture: true },
    );
    return stdout.trim();
  } catch (error) {
    if (error instanceof CommandError) {
      throw new Error(
        `${prefix} ${ref} is not a commit in this checkout; fetch it, or pass a commit that is here`,
      );
    }
    throw error;
  }
}

/** Refuses when `gh` has no login, since the artifact cannot be listed without one. */
async function requireSignIn(root: string, runner: Runner): Promise<void> {
  try {
    await runner.run("gh", ["auth", "status"], { cwd: root, capture: true });
  } catch (error) {
    if (error instanceof CommandError) {
      throw new Error(
        `${prefix} gh is not signed in, so the charts-main artifact cannot be listed; run gh auth login (or set GH_TOKEN), then rerun`,
      );
    }
    throw error;
  }
}

/**
 * The artifacts of this name, newest first. The name carries the commit's full
 * sha, so an artifact is never taken for another commit's.
 */
async function artifactsNamed(
  root: string,
  runner: Runner,
  name: string,
): Promise<ArtifactRecord[]> {
  const { stdout } = await runner.run(
    "gh",
    ["api", `repos/{owner}/{repo}/actions/artifacts?name=${name}`],
    { cwd: root, capture: true },
  );
  const listing = JSON.parse(stdout) as { artifacts: ArtifactRecord[] };
  return listing.artifacts
    .filter((artifact) => artifact.name === name)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * Writes the main chart lock of a commit (the checkout's HEAD when none is
 * given) to `output`. The charts-main job uploads it for each push to main; it
 * expires after 30 days. This is read-only: it touches no cluster, and
 * `--require-fresh-lock` still gates the proof that uses it.
 */
export async function fetchMainChartLock(
  runner: Runner,
  options: { root: string; commit?: string | undefined; output: string },
): Promise<MainChartLock> {
  const { root, output } = options;
  const commit = await commitOf(root, runner, options.commit ?? "HEAD");
  await requireSignIn(root, runner);
  const name = `${lockFile}-${commit}`;
  const found = await artifactsNamed(root, runner, name);
  if (found.length === 0) {
    throw new Error(
      `${prefix} no charts-main artifact for commit ${commit} (${name}); the charts-main job publishes it on each push to main, so push the commit to main, wait for its run to finish green, then rerun`,
    );
  }
  const usable = found.find((artifact) => !artifact.expired);
  if (usable === undefined) {
    const last = found[0]!;
    throw new Error(
      `${prefix} the charts-main artifact for commit ${commit} expired on ${last.expires_at}; artifacts are kept 30 days. Rerun that commit's workflow run with gh run rerun ${last.workflow_run.id}, which publishes the lock again, or fetch the lock for a newer commit on main`,
    );
  }
  const runId = usable.workflow_run.id;
  const scratch = await mkdtemp(join(tmpdir(), "kore-main-chart-lock-"));
  try {
    await runner.run(
      "gh",
      ["run", "download", String(runId), "--name", name, "--dir", scratch],
      { cwd: root, capture: true },
    );
    await copyFile(join(scratch, lockFile), output);
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
  return { commit, path: output, artifact: name, runId };
}
