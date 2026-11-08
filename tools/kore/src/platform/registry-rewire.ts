import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

const namespace = "kore-registry";
const service = "oci-registry";

/**
 * A Service's clusterIP is immutable, so a profile created before the address
 * was pinned keeps a random one that the image policy glob no longer matches.
 * Deleting only the Service lets the next oci-registry reconcile recreate it on
 * the pinned address; the Deployment and the PVC (pushed images) are untouched
 * and running pods keep the address they pulled by. Returns whether it deleted.
 */
export async function rewireRegistryService(
  repository: Repository,
  runner: Runner,
  log: (message: string) => void = () => undefined,
): Promise<boolean> {
  const pinned = repository.registryClusterIP;
  if (pinned === undefined) {
    return false;
  }
  const scope = [
    "--context",
    repository.environment.kubeContext,
    "--namespace",
    namespace,
  ];
  const { stdout } = await runner.run(
    "kubectl",
    [
      ...scope,
      "get",
      "service",
      service,
      "--ignore-not-found",
      "-o",
      "jsonpath={.spec.clusterIP}",
    ],
    { capture: true },
  );
  const live = stdout.trim();
  if (live === "" || live === pinned) {
    return false;
  }
  log(
    `rewiring ${service} Service in ${namespace} (${repository.environment.name}): clusterIP ${live} -> ${pinned}; the Deployment and stored images are kept`,
  );
  await runner.run(
    "kubectl",
    [...scope, "delete", "service", service, "--ignore-not-found"],
    { capture: true },
  );
  return true;
}
