import type { Repository } from "./types.js";

/**
 * The environment whose host the k3s Ansible role converges: the role reads
 * that overlay as k3s_vps_environment. Only it carries a k3s host pin.
 */
export const k3sHostEnvironment = "vps";

/** The role's defaults, which hold the k3s release the host installs. */
export const k3sPinFile = "infra/hosts/vps/roles/k3s/defaults/main.yaml";

const k3sRelease = /^v?(\d+\.\d+\.\d+)\+k3s\d+$/;

/**
 * The host's k3s pin and the host overlay's cluster.kubernetesVersion are two
 * copies of one fact. They must name the same Kubernetes version, so a move of
 * one is made with the other in the same pull request.
 */
export function k3sPinErrors(repository: Repository): string[] {
  const { environment, k3sHostPin } = repository;
  if (environment.name !== k3sHostEnvironment || k3sHostPin === undefined) {
    return [];
  }
  const pinned = k3sRelease.exec(k3sHostPin)?.[1];
  if (pinned === undefined) {
    return [
      `${k3sPinFile}: k3s_version ${k3sHostPin} is not a k3s release; use v<major.minor.patch>+k3s<n>, for example v1.37.2+k3s1`,
    ];
  }
  const overlay = environment.cluster?.kubernetesVersion ?? "(none)";
  if (overlay.replace(/^v/, "") === pinned) {
    return [];
  }
  return [
    `k3s pin ${k3sHostPin} in ${k3sPinFile} and the ${environment.name} overlay's cluster.kubernetesVersion ${overlay} disagree; move both to the same Kubernetes version in the same pull request`,
  ];
}
