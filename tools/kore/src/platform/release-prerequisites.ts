import {
  featureEnabled,
  platformDnsFlag,
  type Component,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { ensureLocalCaTrust } from "../security/index.js";
import { enrollSharedGatewayRoute } from "./enrollment.js";

/**
 * What a configuration release needs in the cluster before it is applied and
 * waited on, whoever delivers it (Helm, or Argo CD once it has taken the release
 * over).
 *
 * The portal's pods mount the local CA from a ConfigMap kore applies, and only
 * with platform-dns on (ADR 0132). A route waits for admission inside its
 * release's readiness check, so the namespace of a component that attaches one
 * carries the shared Gateway label first (ADR 0134, #1388).
 */
export async function prepareConfigurationRelease(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<void> {
  if (
    component.name === "kore-platform-backstage" &&
    featureEnabled(repository.environment, platformDnsFlag)
  ) {
    await ensureLocalCaTrust(repository, runner, component.namespace);
  }
  await enrollSharedGatewayRoute(repository, runner, component);
}
