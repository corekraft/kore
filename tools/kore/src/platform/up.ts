import {
  enabledComponents,
  isLocalProvider,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { startLocalTunnel, type TunnelDependencies } from "../tunnel/index.js";
import { installLocalTrust } from "../security/index.js";
import { bootstrapControllers, openApplicationAdmission } from "./bootstrap.js";
import { enrollPlatformNamespaces } from "./enrollment.js";
import { writePlatformState } from "./platform-state.js";
import { reconcileConfiguration } from "./reconcile.js";

export async function platformUp(
  repository: Repository,
  runner: Runner,
  tunnelDependencies: TunnelDependencies = {},
): Promise<void> {
  await bootstrapControllers(repository, runner);
  if (isLocalProvider(repository.environment)) {
    await installLocalTrust(repository, runner);
  }
  // Only Minikube needs a host tunnel; the k3d load balancer publishes the
  // Gateway port with no process of Kore's own (ADR 0076).
  const needsTunnel = repository.environment.provider === "minikube";
  let tunnelStarted = false;
  for (const component of enabledComponents(repository)) {
    if (
      component.phase !== "configuration" &&
      component.phase !== "enforcement"
    ) {
      continue;
    }
    const createsGateway = component.readiness.some((resource) =>
      resource.startsWith("gateway/"),
    );
    const startTunnelAfterApply =
      needsTunnel && !tunnelStarted && createsGateway
        ? async () => {
            await startLocalTunnel(repository, runner, tunnelDependencies);
            tunnelStarted = true;
          }
        : undefined;
    await reconcileConfiguration(
      repository,
      runner,
      component,
      startTunnelAfterApply,
    );
  }
  if (needsTunnel && !tunnelStarted) {
    await startLocalTunnel(repository, runner, tunnelDependencies);
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
