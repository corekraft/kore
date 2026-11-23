import {
  releaseOwner,
  type Component,
  type Repository,
} from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";

/**
 * A Helm release a recovery may act on: a catalog component or an app release.
 * An app release names no owner, so it is kore's.
 */
export interface ReleaseTarget extends Partial<Pick<Component, "owner">> {
  name: string;
  namespace: string;
  timeout: string;
}

export type Recovery = "none" | "uninstalled" | "rolled-back";

interface Revision {
  revision?: number;
  status?: string;
}

// A first install that never reached `deployed`: nothing healthy to preserve.
const neverDeployed = new Set(["uninstalling", "pending-install", "failed"]);
// A canceled upgrade or rollback: an earlier revision is still the live one.
const canceledChange = new Set(["pending-upgrade", "pending-rollback"]);

function scope(repository: Repository, target: ReleaseTarget): string[] {
  return [
    "--namespace",
    target.namespace,
    "--kube-context",
    repository.environment.kubeContext,
  ];
}

async function history(
  repository: Repository,
  runner: Runner,
  target: ReleaseTarget,
): Promise<Revision[] | undefined> {
  try {
    const { stdout } = await runner.run(
      "helm",
      [
        "history",
        target.name,
        ...scope(repository, target),
        "--output",
        "json",
      ],
      { capture: true },
    );
    return JSON.parse(stdout) as Revision[];
  } catch (error) {
    if (
      error instanceof CommandError &&
      /release: not found/.test(error.result.stderr)
    ) {
      return undefined;
    }
    throw error;
  }
}

function lastRevisionWith(
  revisions: Revision[],
  status: string,
): number | undefined {
  return revisions.findLast((entry) => entry.status === status)?.revision;
}

/**
 * Clears the leftovers of a failed or canceled release attempt so the next
 * `helm upgrade --install` can proceed, and proves it did:
 * - a release that never deployed is uninstalled and must then be gone;
 * - a canceled upgrade or rollback returns to the last deployed revision
 *   (never an uninstall, which would remove a healthy release) and the latest
 *   revision must then be deployed; a release Argo CD owns is refused instead,
 *   naming its git revert, because helm rollback never runs under Argo CD;
 * - a release that was deployed before a failed upgrade is left to Helm.
 * `beforeUninstall` runs first and may refuse (retained data). Returns what it
 * did. Other history failures are rethrown, never read as a missing release.
 */
export async function recoverRelease(
  repository: Repository,
  runner: Runner,
  target: ReleaseTarget,
  beforeUninstall?: () => Promise<void>,
): Promise<Recovery> {
  const revisions = await history(repository, runner, target);
  if (!revisions?.length) {
    return "none";
  }
  const latest = revisions.at(-1)?.status ?? "";
  const common = [...scope(repository, target), "--wait", "--timeout"];
  if (revisions.every(({ status }) => neverDeployed.has(status ?? ""))) {
    await beforeUninstall?.();
    await runner.run(
      "helm",
      ["uninstall", target.name, ...common, target.timeout],
      { capture: false },
    );
    if (await history(repository, runner, target)) {
      throw new Error(
        `release ${target.name} in namespace ${target.namespace} is still present after uninstall; check it with helm history ${target.name} --namespace ${target.namespace} and rerun`,
      );
    }
    return "uninstalled";
  }
  if (canceledChange.has(latest)) {
    const live =
      lastRevisionWith(revisions, "deployed") ??
      lastRevisionWith(revisions, "superseded");
    if (live === undefined) {
      return "none";
    }
    // An Argo CD owned release is never rolled back by helm (ADR 0153): its
    // owner reverts its record in git, or the flag is turned off.
    if (releaseOwner(repository.environment, target) === "argocd") {
      throw new Error(
        `release ${target.name} in namespace ${target.namespace} is owned by Argo CD, so kore refuses helm rollback to revision ${live}; roll it back with a git revert of its record in infra/catalog/components.yaml, or turn platform-argocd-delivery off in ${repository.environment.name} to hand it back to Helm (ADR 0153)`,
      );
    }
    await runner.run(
      "helm",
      ["rollback", target.name, String(live), ...common, target.timeout],
      { capture: false },
    );
    const after = await history(repository, runner, target);
    if (after?.at(-1)?.status !== "deployed") {
      throw new Error(
        `release ${target.name} in namespace ${target.namespace} is not deployed after rolling back to revision ${live}; check helm history and rerun`,
      );
    }
    return "rolled-back";
  }
  return "none";
}
