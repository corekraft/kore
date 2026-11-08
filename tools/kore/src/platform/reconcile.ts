import type { Component, Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { helmUpgradeArgs, manifestSource, withAbsoluteChart } from "./helm.js";
import {
  assertOwnedCrdsExist,
  errorMessage,
  helmReleaseStatus,
} from "./probe.js";
import { waitFor } from "./readiness.js";

const neverDeployed = new Set(["uninstalling", "pending-install", "failed"]);

/**
 * Clears a release whose first install never reached `deployed` (for example a
 * run interrupted mid-install or mid-rollback), which `helm upgrade --install`
 * otherwise refuses with "has no deployed releases". A release that was ever
 * deployed is left for Helm to upgrade or roll back. Returns whether it
 * uninstalled anything.
 */
export async function recoverUndeployedRelease(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<boolean> {
  const scope = [
    "--namespace",
    component.namespace,
    "--kube-context",
    repository.environment.kubeContext,
  ];
  let stdout: string;
  try {
    ({ stdout } = await runner.run(
      "helm",
      ["history", component.name, ...scope, "--output", "json"],
      { capture: true },
    ));
  } catch (error) {
    if (
      error instanceof CommandError &&
      /release: not found/.test(error.result.stderr)
    ) {
      return false;
    }
    throw error;
  }
  const revisions = JSON.parse(stdout) as { status?: string }[];
  if (
    revisions.length === 0 ||
    !revisions.every(({ status }) => neverDeployed.has(status ?? ""))
  ) {
    return false;
  }
  await runner.run(
    "helm",
    [
      "uninstall",
      component.name,
      ...scope,
      "--wait",
      "--timeout",
      component.timeout,
    ],
    { capture: false },
  );
  return true;
}

async function applyComponent(
  repository: Repository,
  runner: Runner,
  component: Component,
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
    runner.run(
      "helm",
      withAbsoluteChart(
        repository,
        component,
        helmUpgradeArgs(repository, component),
      ),
      { capture: false, cwd: repository.root },
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
): Promise<void> {
  try {
    await applyComponent(repository, runner, component);
    await afterApply?.();
    await waitFor(repository, runner, component);
  } catch (error) {
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

/** Waits for an installed component, otherwise reconciles it. */
export async function reconcileIfNeeded(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<void> {
  if (await componentIsInstalled(repository, runner, component)) {
    await waitFor(repository, runner, component);
    return;
  }
  await reconcileComponent(repository, runner, component);
}
