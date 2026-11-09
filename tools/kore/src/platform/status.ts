import {
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
import { readinessFailure } from "./readiness.js";

export interface ComponentStatus {
  name: string;
  namespace: string;
  status: "ready" | "missing" | "degraded";
  detail: string;
  /** Present on the image-inventory row: every inventoried image and finding. */
  inventory?: ImageInventory;
}

async function componentStatus(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<ComponentStatus> {
  const identity = { name: component.name, namespace: component.namespace };
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
  const failure = await readinessFailure(repository, runner, component);
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
  for (const component of orderedComponents(repository.catalog)) {
    if (only && !only.includes(component.name)) {
      continue;
    }
    result.push(await componentStatus(repository, runner, component));
  }
  // The gate and the inventory are platform-wide rows, not components: a
  // filtered query omits them.
  if (!only) {
    result.push(await imageInventoryStatus(repository, runner));
    result.push(await admissionGateStatus(repository, runner));
  }
  return result;
}
