import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { orderedComponents, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { startLocalTunnel, type TunnelDependencies } from "../tunnel/index.js";
import { installLocalTrust } from "../security/index.js";
import { bootstrapControllers } from "./bootstrap.js";
import { reconcileComponent } from "./reconcile.js";

async function writePlatformState(
  repository: Repository,
  status: string,
): Promise<void> {
  const directory = join(repository.root, ".kore", "state");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${repository.environment.name}.json`),
    JSON.stringify(
      {
        environment: repository.environment.name,
        context: repository.environment.kubeContext,
        status,
        reconciledAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

export async function platformUp(
  repository: Repository,
  runner: Runner,
  tunnelDependencies: TunnelDependencies = {},
): Promise<void> {
  await bootstrapControllers(repository, runner);
  const local = repository.environment.provider === "minikube";
  if (local) {
    await installLocalTrust(repository, runner);
  }
  let tunnelStarted = false;
  for (const component of orderedComponents(repository.catalog)) {
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
      local && !tunnelStarted && createsGateway
        ? async () => {
            await startLocalTunnel(repository, runner, tunnelDependencies);
            tunnelStarted = true;
          }
        : undefined;
    await reconcileComponent(
      repository,
      runner,
      component,
      startTunnelAfterApply,
    );
  }
  if (local && !tunnelStarted) {
    await startLocalTunnel(repository, runner, tunnelDependencies);
  }
  await writePlatformState(repository, "ready");
}
