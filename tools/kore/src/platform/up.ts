import {
  enabledComponents,
  isLocalProvider,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { installLocalTrust } from "../security/index.js";
import { bootstrapControllers, openApplicationAdmission } from "./bootstrap.js";
import { enrollPlatformNamespaces } from "./enrollment.js";
import { writePlatformState } from "./platform-state.js";
import { reconcileConfiguration } from "./reconcile.js";

export async function platformUp(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  await bootstrapControllers(repository, runner);
  if (isLocalProvider(repository.environment)) {
    await installLocalTrust(repository, runner);
  }
  for (const component of enabledComponents(repository)) {
    if (
      component.phase !== "configuration" &&
      component.phase !== "enforcement"
    ) {
      continue;
    }
    await reconcileConfiguration(repository, runner, component);
  }
  // Every phase is done, so Policy Controller and the image policies are ready:
  // enforce environments enroll their namespaces now, before the inventory
  // judges them (ADR 0056).
  await enrollPlatformNamespaces(repository, runner);
  // Bootstrap closed the gate first; it opens only if every component is ready
  // after all phases of this run (ADR 0054).
  await openApplicationAdmission(repository, runner);
  await writePlatformState(repository, "ready");
}
