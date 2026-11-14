// Fixtures only the k3d-cluster spec reads: the arguments the overlay produces, and
// the host trust directory. A support file is not a unit, so it needs no spec of
// its own (ADR 0098).
import { pinnedK3s } from "./cluster-support.js";

export const TRUST = "/home/u/.kore/k3d/kore-local/registry-trust";

/** The registry trust mounts k3dTrustVolumeArgs returns for `TRUST`. */
export const TRUST_VOLUMES = [
  "--volume",
  `${TRUST}:/etc/kore/registry-ca@all`,
  "--volume",
  `${TRUST}/registries.yaml:/etc/rancher/k3s/registries.yaml@all`,
];

/** The `k3d cluster create` arguments the overlay produces, with the given volumes. */
export function createArgs(
  volumes: readonly string[] = TRUST_VOLUMES,
): string[] {
  return [
    "cluster",
    "create",
    "kore-local",
    "--image",
    pinnedK3s,
    "--servers",
    "1",
    "--agents",
    "0",
    "--k3s-arg",
    "--disable=traefik@server:*",
    "--k3s-arg",
    "--disable=servicelb@server:*",
    "--k3s-arg",
    "--service-cidr=10.96.0.0/12@server:*",
    "--port",
    "8443:443@loadbalancer",
    ...volumes,
    "--kubeconfig-update-default=true",
    "--kubeconfig-switch-context=false",
    "--wait",
    "--timeout",
    "300s",
  ];
}

export const LIST = "k3d cluster list --output json";

export const NAMESPACE_CHECK =
  "kubectl --context k3d-kore-local get namespace kube-system -o jsonpath={.metadata.name}";

/** What `k3d cluster list` reports for the running cluster, as clusterStatusK3d returns it, less its environment name. */
export const RUNNING_STATUS = {
  cluster: "kore-local",
  context: "k3d-kore-local",
  state: "running",
  status: {
    serversCount: 1,
    serversRunning: 1,
    agentsCount: 0,
    agentsRunning: 0,
    hasLoadBalancer: true,
  },
};

/** The exact errors a person reads, named by the case they describe. */
export const MESSAGES = {
  unpinned:
    "versions.images.k3s is not pinned; add the digest-pinned k3s image to infra/catalog/versions.yaml",
  noSettings:
    "environment local has no k3d cluster settings; it is a k3d overlay, so k3d commands do not apply to it",
  unreadable:
    "k3d cluster list --output json printed unreadable output, not JSON: not json",
  notList: "printed unreadable output: expected a JSON list",
  unavailable:
    "k3d cluster kore-local is unavailable because `k3d cluster list` failed; k3d is not available; install k3d (mise install) and check that Docker is running",
  contextRefused:
    "refusing unexpected cluster/context pair: k3d-kore-local != other-context; set environment.kubeContext to k3d-kore-local; check `kubectl config get-contexts` for the contexts this machine has",
  productionRefused:
    "refusing unexpected cluster/context pair: k3d-kore-local != production",
  stopped:
    "k3d cluster kore-local is stopped; run `kore local up` to create or start it",
  absent:
    "k3d cluster kore-local is absent; run `kore local up` to create or start it",
  wrongNamespace:
    /did not identify the expected cluster.*set environment\.kubeContext to k3d-kore-local/s,
  overlayServers: /servers: 3 != 1.*kore local down --prune.*kore local up/s,
  wrongPort: "port 443: 9443 != 8443",
  unmappedPort: "port 443: unmapped != 8443",
  install: /install k3d \(mise install\)/,
};
