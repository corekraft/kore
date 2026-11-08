import type { Component, Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { helmUpgradeArgs, manifestSource, withAbsoluteChart } from "./helm.js";
import {
  assertOwnedCrdsExist,
  errorMessage,
  helmReleaseStatus,
} from "./probe.js";
import { waitFor } from "./readiness.js";

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
  await runner.run(
    "helm",
    withAbsoluteChart(
      repository,
      component,
      helmUpgradeArgs(repository, component),
    ),
    { capture: false, cwd: repository.root },
  );
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
