import {
  orderedComponents,
  type Component,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import {
  assertOwnedCrdsExist,
  errorMessage,
  helmReleaseStatus,
} from "./probe.js";
import { readinessFailure } from "./readiness.js";

export interface ComponentStatus {
  name: string;
  namespace: string;
  status: "ready" | "missing" | "degraded";
  detail: string;
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

export async function platformStatus(
  repository: Repository,
  runner: Runner,
): Promise<ComponentStatus[]> {
  const result: ComponentStatus[] = [];
  for (const component of orderedComponents(repository.catalog)) {
    result.push(await componentStatus(repository, runner, component));
  }
  return result;
}
