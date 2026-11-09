import type { Component, Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { FailFastError, withFailFast, type WatchOptions } from "./fail-fast.js";
import { desiredFingerprint } from "./fingerprint.js";
import {
  envOption,
  helmEnv,
  helmUpgradeArgs,
  manifestSource,
  withAbsoluteChart,
} from "./helm.js";
import {
  assertOwnedCrdsExist,
  errorMessage,
  helmReleaseStatus,
} from "./probe.js";
import { waitFor } from "./readiness.js";
import { recoverRelease } from "./release-recovery.js";

/**
 * Clears a release a run left in the way: a first install that never reached
 * `deployed` is uninstalled, a canceled upgrade is rolled back to its last
 * deployed revision, which `helm upgrade --install` otherwise refuses ("has no
 * deployed releases", "another operation is in progress"). A release that was
 * ever deployed is never uninstalled. Returns whether it changed anything.
 */
export async function recoverUndeployedRelease(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<boolean> {
  return (await recoverRelease(repository, runner, component)) !== "none";
}

async function applyComponent(
  repository: Repository,
  runner: Runner,
  component: Component,
  watch: WatchOptions,
): Promise<void> {
  if (component.kind === "manifest") {
    await runner.run(
      "kubectl",
      [
        "--context",
        repository.environment.kubeContext,
        "apply",
        "--server-side",
        "--field-manager=kore",
        "--recursive",
        "--filename",
        manifestSource(repository, component),
      ],
      { capture: false },
    );
    return;
  }
  const upgrade = () =>
    withFailFast(
      repository,
      runner,
      component,
      (guarded) =>
        guarded.run(
          "helm",
          withAbsoluteChart(repository, component, [
            ...helmUpgradeArgs(repository, component),
            "--description",
            desiredFingerprint(repository, component),
          ]),
          {
            capture: false,
            cwd: repository.root,
            ...envOption(helmEnv(repository, component)),
          },
        ),
      watch,
    );
  try {
    await upgrade();
  } catch (error) {
    // The upgrade output streams to the terminal, so the error cannot say why;
    // the history check alone decides whether a never-deployed release is in the way.
    if (!(error instanceof CommandError)) {
      throw error;
    }
    if (!(await recoverUndeployedRelease(repository, runner, component))) {
      throw error;
    }
    await upgrade();
  }
}

export async function reconcileComponent(
  repository: Repository,
  runner: Runner,
  component: Component,
  afterApply?: () => Promise<void>,
  watch: WatchOptions = {},
): Promise<void> {
  try {
    await applyComponent(repository, runner, component, watch);
    await afterApply?.();
    await withFailFast(
      repository,
      runner,
      component,
      (guarded) => waitFor(repository, guarded, component),
      watch,
    );
  } catch (error) {
    if (error instanceof FailFastError) {
      throw error;
    }
    throw new Error(
      `component ${component.name} failed to become ready: ${errorMessage(error)}`,
    );
  }
}

async function componentIsInstalled(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<boolean> {
  try {
    if (component.kind === "manifest") {
      if (!component.ownsCRDs.length) {
        return false;
      }
      await assertOwnedCrdsExist(repository, runner, component);
      return true;
    }
    return (
      (await helmReleaseStatus(repository, runner, component)) === "deployed"
    );
  } catch {
    return false;
  }
}

/**
 * Whether the deployed revision of a release was applied from the given
 * fingerprint. Helm cannot tell kore what values files and local chart contents
 * it was given, so kore records a digest of them in the revision description on
 * every upgrade (see argsFingerprint). A missing release, or a missing or
 * different description, means drift. A failure to read the history is not
 * drift: it is reported, never swallowed.
 */
export async function releaseMatchesFingerprint(
  repository: Repository,
  runner: Runner,
  release: { name: string; namespace: string },
  fingerprint: string,
): Promise<boolean> {
  let stdout: string;
  try {
    ({ stdout } = await runner.run(
      "helm",
      [
        "history",
        release.name,
        "--namespace",
        release.namespace,
        "--kube-context",
        repository.environment.kubeContext,
        "--output",
        "json",
      ],
      { capture: true },
    ));
  } catch (error) {
    if (
      error instanceof CommandError &&
      /release: not found/.test(error.result.stderr)
    ) {
      return false;
    }
    throw new Error(
      `cannot read the deployed state of release ${release.name} in ${release.namespace} (${repository.environment.kubeContext}) to check for drift: ${errorMessage(error)}. Check cluster access, then rerun.`,
    );
  }
  const revisions = JSON.parse(stdout) as {
    status?: string;
    description?: string;
  }[];
  const deployed = revisions.filter(({ status }) => status === "deployed");
  return deployed.at(-1)?.description === fingerprint;
}

async function releaseMatchesDesiredState(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<boolean> {
  return releaseMatchesFingerprint(
    repository,
    runner,
    component,
    desiredFingerprint(repository, component),
  );
}

/**
 * Waits for an installed component whose deployed state matches the repository,
 * otherwise reconciles it. Manifest components apply idempotently when absent
 * and are only awaited once their CRDs exist.
 */
export async function reconcileIfNeeded(
  repository: Repository,
  runner: Runner,
  component: Component,
  watch: WatchOptions = {},
): Promise<void> {
  if (
    (await componentIsInstalled(repository, runner, component)) &&
    (component.kind === "manifest" ||
      (await releaseMatchesDesiredState(repository, runner, component)))
  ) {
    await withFailFast(
      repository,
      runner,
      component,
      (guarded) => waitFor(repository, guarded, component),
      watch,
    );
    return;
  }
  await reconcileComponent(repository, runner, component, undefined, watch);
}

/**
 * Reconciles a configuration component on every `kore local up`. A Helm release
 * that is deployed from the current desired state is not upgraded, only
 * awaited, so a second run of unchanged state changes no release. `afterApply`
 * runs either way, since it carries steps (the local tunnel) that a skipped
 * upgrade must not lose. Manifests are applied every time: a server-side apply
 * is idempotent and their content is not fingerprinted.
 */
export async function reconcileConfiguration(
  repository: Repository,
  runner: Runner,
  component: Component,
  afterApply?: () => Promise<void>,
  watch: WatchOptions = {},
): Promise<void> {
  if (
    component.kind !== "manifest" &&
    (await componentIsInstalled(repository, runner, component)) &&
    (await releaseMatchesDesiredState(repository, runner, component))
  ) {
    await afterApply?.();
    await withFailFast(
      repository,
      runner,
      component,
      (guarded) => waitFor(repository, guarded, component),
      watch,
    );
    return;
  }
  await reconcileComponent(repository, runner, component, afterApply, watch);
}
