import { isLocalProvider, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { installLocalTrust } from "../security/index.js";
import {
  bootstrapControllers,
  openApplicationAdmission,
  orphanCheckDeferred,
} from "./bootstrap.js";
import { assertNoOrphanedReleases } from "./gated-release.js";
import { enrollPlatformNamespaces } from "./enrollment.js";
import { awaitArgocdDelivery, reconcileConfigurations } from "./handover.js";
import { writePlatformState } from "./platform-state.js";

export async function platformUp(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  await bootstrapControllers(repository, runner, { orphanCheck: "caller" });
  if (isLocalProvider(repository.environment)) {
    await installLocalTrust(repository, runner);
  }
  await reconcileConfigurations(repository, runner);
  // Deferred by `gateway-rollback-order`: the refusal comes once the
  // configuration is re-rendered, and still ends the run (ADR 0081 addendum).
  if (orphanCheckDeferred(repository)) {
    await assertNoOrphanedReleases(repository, runner);
  }
  // Argo CD delivers asynchronously: its Applications and every release it owns
  // must be ready before enrollment and the gate judge them (ADR 0043).
  await awaitArgocdDelivery(repository, runner);
  // Every phase is done, so Policy Controller and the image policies are ready:
  // enforce environments enroll their namespaces now, before the inventory
  // judges them (ADR 0056).
  await enrollPlatformNamespaces(repository, runner);
  // Bootstrap closed the gate first; it opens only if every component is ready
  // after all phases of this run (ADR 0054).
  await openApplicationAdmission(repository, runner);
  await writePlatformState(repository, "ready");
}
