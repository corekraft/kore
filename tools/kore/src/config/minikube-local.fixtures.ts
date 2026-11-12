import { loadRepository } from "./config.js";
import type { Repository } from "./types.js";

/**
 * The local repository as it was while the overlay still named Minikube. The
 * Minikube code paths stay until the provider is retired (plan 9 step 6), and
 * their specs keep proving them against this view of the overlay rather than
 * against the k3d overlay, which they must not see.
 */
export async function loadMinikubeLocal(start?: string): Promise<Repository> {
  const base = await loadRepository("local", start);
  const { k3d: _k3d, ...environment } = base.environment;
  return {
    ...base,
    environment: {
      ...environment,
      provider: "minikube",
      kubeContext: "kore-local",
      cluster: {
        profile: "kore-local",
        kubernetesVersion: "1.37.2",
        driver: "docker",
        containerRuntime: "containerd",
        cpus: 4,
        memoryMB: 8192,
        diskSize: "40g",
        serviceCidr: "10.96.0.0/12",
      },
    },
  };
}
