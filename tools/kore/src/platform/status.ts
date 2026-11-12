import {
  componentGatedOff,
  orderedComponents,
  type Component,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { admissionGateStatus } from "./admission-gate.js";
import {
  assertOwnedCrdsExist,
  errorMessage,
  helmReleaseStatus,
} from "./probe.js";
import {
  imageInventoryStatus,
  type ImageInventory,
} from "./image-inventory.js";
import { gatedReleaseProblem } from "./gated-release.js";
import {
  readinessFailure,
  retryBudget,
  type RetryBudget,
} from "./readiness.js";
import { registryTrustProblem } from "../images/index.js";

export interface ComponentStatus {
  name: string;
  namespace: string;
  status: "ready" | "missing" | "degraded" | "gated-off";
  detail: string;
  /** Present on the image-inventory row: every inventoried image and finding. */
  inventory?: ImageInventory;
}

async function componentStatus(
  repository: Repository,
  runner: Runner,
  component: Component,
  budget: RetryBudget,
): Promise<ComponentStatus> {
  const identity = { name: component.name, namespace: component.namespace };
  if (componentGatedOff(repository.environment, component)) {
    const problem = await gatedReleaseProblem(repository, runner, component);
    return problem
      ? { ...identity, status: "degraded", detail: problem }
      : {
          ...identity,
          status: "gated-off",
          detail: `gated off: feature ${component.featureFlag} is off in ${repository.environment.name}`,
        };
  }
  try {
    if (component.kind === "manifest") {
      await assertOwnedCrdsExist(repository, runner, component);
    } else {
      const releaseStatus = await helmReleaseStatus(
        repository,
        runner,
        component,
      );
      if (releaseStatus && releaseStatus !== "deployed") {
        return {
          ...identity,
          status: "degraded",
          detail: `Helm release status is ${releaseStatus}`,
        };
      }
    }
  } catch (error) {
    return { ...identity, status: "missing", detail: errorMessage(error) };
  }
  const failure = await readinessFailure(repository, runner, component, budget);
  return failure
    ? { ...identity, status: "degraded", detail: failure }
    : { ...identity, status: "ready", detail: "installed and ready" };
}

/** Reports every component, or only the named ones when `only` is given. */
export async function platformStatus(
  repository: Repository,
  runner: Runner,
  only?: readonly string[],
): Promise<ComponentStatus[]> {
  const result: ComponentStatus[] = [];
  const budget = retryBudget();
  for (const component of orderedComponents(repository.catalog)) {
    if (only && !only.includes(component.name)) {
      continue;
    }
    result.push(await componentStatus(repository, runner, component, budget));
  }
  // The gate and the inventory are platform-wide rows, not components: a
  // filtered query omits them.
  if (!only) {
    result.push(await registryTrustStatus(repository, runner));
    result.push(await imageInventoryStatus(repository, runner));
    result.push(await admissionGateStatus(repository, runner));
  }
  return result;
}

export const registryTrustStatusName = "registry-trust";

/** Fails closed: a missing CA is a degraded row, which keeps the gate shut. */
async function registryTrustStatus(
  repository: Repository,
  runner: Runner,
): Promise<ComponentStatus> {
  const problem = await registryTrustProblem(repository, runner);
  return {
    name: registryTrustStatusName,
    namespace: "kore-registry",
    status: problem === undefined ? "ready" : "degraded",
    detail: problem ?? "registry CA present; every client verifies it",
  };
}

// Callers that read the inventory row by name need no second import.
export { imageInventoryStatusName } from "./image-inventory.js";
