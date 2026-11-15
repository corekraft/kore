import {
  helmInstalledComponents,
  isLocalProvider,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { installLocalTrust } from "../security/index.js";
import { bootstrapControllers, openApplicationAdmission } from "./bootstrap.js";
import {
  composeChartDelivery,
  prepareChartDelivery,
} from "./chart-delivery.js";
import { enrollPlatformNamespaces } from "./enrollment.js";
import { writePlatformState } from "./platform-state.js";
import { reconcileConfiguration } from "./reconcile.js";

export interface PlatformUpOptions {
  /** The platform-charts.lock.json of a release; required while the delivery flag is on. */
  platformChartLock?: string | undefined;
}

export async function platformUp(
  given: Repository,
  runner: Runner,
  options: PlatformUpOptions = {},
): Promise<void> {
  // Schema-check the lock and catalog before any cluster is touched.
  const repository = await composeChartDelivery(
    given,
    options.platformChartLock,
  );
  await bootstrapControllers(repository, runner);
  if (isLocalProvider(repository.environment)) {
    await installLocalTrust(repository, runner);
  }
  for (const component of helmInstalledComponents(repository)) {
    if (
      component.phase !== "configuration" &&
      component.phase !== "enforcement"
    ) {
      continue;
    }
    await prepareChartDelivery(repository, runner, component);
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
