import { loadRepository, type Repository } from "../config/index.js";

/** The cluster settings a managed overlay declares. */
export const managedClusterSettings = {
  profile: "kore-local",
  kubernetesVersion: "1.37.2",
  driver: "external",
  containerRuntime: "containerd",
  cpus: 4,
  memoryMB: 8192,
  diskSize: "40g",
  serviceCidr: "10.96.0.0/12",
};

/**
 * The local repository viewed as a managed environment: the same catalog with
 * the k3d block and its provider-owned CRD groups removed and the cluster
 * settings a managed overlay declares. Specs use it where a non-k3d provider
 * must behave as it does, without reading the k3d overlay.
 */
export async function loadManagedLocal(start?: string): Promise<Repository> {
  const base = await loadRepository("local", start);
  // A managed cluster ships none of the k3s CRDs the k3d overlay declares provider-owned.
  const {
    k3d: _k3d,
    providerOwnedCRDGroups: _providerOwned,
    ...environment
  } = base.environment;
  return {
    ...base,
    environment: {
      ...environment,
      provider: "managed",
      kubeContext: "kore-local",
      cluster: managedClusterSettings,
    },
  };
}
