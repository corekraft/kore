import { registryPlan, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

/**
 * Returns the environment's registry.address after proving the in-cluster
 * Service actually answers there. The address is configuration, never a live
 * lookup; the lookup only detects drift (a Service created before the address
 * changed) so push, sign, and deploy fail before using a dead reference.
 * Addresses that are hostnames name an external registry and are not checked
 * against a Service.
 */
export async function verifiedRegistryAddress(
  repository: Repository,
  runner: Runner,
): Promise<string> {
  const plan = registryPlan(repository.environment);
  if (plan.clusterIP === undefined) {
    return plan.address;
  }
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      "kore-registry",
      "get",
      "service",
      "oci-registry",
      "--output=jsonpath={.spec.clusterIP}",
    ],
    { capture: true },
  );
  const live = stdout.trim();
  if (live === "") {
    throw new Error(
      `local OCI registry Service oci-registry has no ClusterIP in kore-registry; run \`kore platform up --env ${repository.environment.name}\` to create it at registry.address ${plan.address}`,
    );
  }
  if (live !== plan.clusterIP) {
    throw new Error(
      `local OCI registry Service answers at ${live} but registry.address ${plan.address} in environment ${repository.environment.name} expects ${plan.clusterIP}; run \`kore platform up --env ${repository.environment.name}\` to recreate the Service at the configured address`,
    );
  }
  return plan.address;
}
