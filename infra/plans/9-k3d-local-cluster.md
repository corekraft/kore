---
status: active
summary: Replace Minikube with k3d for the local environment, delete the tunnel domain, and prove the live suites on k3d.
last-verified: 2026-11-11
---

# k3d Local Cluster Plan

## Purpose

Minikube makes the development machine lag badly. This plan moves the local
environment to k3d
([ADR 0076](../../docs/decisions/0076-k3d-replaces-minikube.md)) and removes
the parts that existed only because of Minikube. It can run in parallel with
plan 8.

## Step 1: Decide the Mapping

### Work

- [x] Record the decision and the Minikube-to-k3d mapping in ADR 0076.
- [x] Pin k3d in `.mise.toml` and the k3s image in `versions.yaml`, with
      compatibility evidence.

### Exit Criteria

- The pins resolve and `mise run validate` passes.

## Step 2: Cluster Lifecycle

### Work

- [ ] Change the provider value to `k3d` in the config types, schema and
      `infra/environments/local/environment.yaml`.
      Progress: types, schema and validator accept `k3d` (with an
      `environment.k3d` block), `managed` and `minikube` (#136); the overlay
      flips in #146 (ADR 0085), which ticks this item once the live proof
      (#149) passes; `kore doctor` checks the pinned `k3d` and `docker` and the
      cluster before anything mutates.
- [ ] Rewrite `cluster/` for `k3d cluster create`, `start`, `stop` and
      `delete`, with Traefik and ServiceLB disabled and ports mapped through
      the k3d load balancer.
- [ ] Keep the readiness wait from ADR 0065 against the k3s API server.
      Progress: `clusterUp` creates or starts the k3d cluster, then runs the
      wait against the configured context; `clusterStatus` and
      `assertExpectedCluster` handle k3d (#138). `clusterStop` and
      `clusterDestroy` handle k3d with the same consent and data gates (#143);
      the lifecycle rewrite item ticks with the live proof.

### Exit Criteria

- `kore local up` creates a k3d cluster from nothing, and `kore cluster status`
  reports it.

## Step 3: Images and Registry Trust

### Work

- [x] Replace `minikube image load` with `k3d image import`.
- [ ] Replace `minikube ssh` CA installation with `registries.yaml` set at
      cluster create. Progress: create mounts the trust directory and
      `registries.yaml`, and the CA is written there after issuance
      ([ADR 0084](../../docs/decisions/0084-k3d-registry-trust-through-a-mounted-ca-directory.md));
      the live proof (#149) remains.
- [ ] Keep Kore's in-cluster TLS registry as the only registry. Progress:
      publishing without a node shell is done ([ADR 0083](../../docs/decisions/0083-k3d-publishes-through-the-node-containerd-client.md)),
      and create adds no k3d registry (ADR 0084); the live proof remains.

### Exit Criteria

- Signed local images are imported and pulled by digest with
  `imagePullPolicy: Never`.

## Step 4: Remove the Tunnel

### Work

- [ ] Delete the `tunnel` domain, its commands, status row and specs.
- [ ] Route Gateway traffic through the k3d load balancer.
      Progress: the overlay publishes the Gateway Service as a NodePort the
      load balancer maps from host 8443, and `platform up` starts no tunnel on
      k3d (#146, [ADR 0085](../../docs/decisions/0085-k3d-gateway-answers-through-a-node-port.md));
      the item ticks once #149 proves it live.
- [ ] Mark ADR 0060 superseded by ADR 0076.

### Exit Criteria

- The Gateway endpoint answers on the host without a tunnel process.

## Step 5: Storage

### Work

- [ ] Point `platform-storage` at the k3s `local-path` provisioner.
- [ ] Re-prove retained-volume discovery (ADR 0061).

### Exit Criteria

- The storage lifecycle integration suite passes on k3d.

## Step 6: Retire Minikube

### Work

- [ ] The operator runs `minikube delete -p kore-local` once, by hand.
- [ ] Move the `minikube delete` deny rule to `k3d cluster delete`, and update
      the guard and its tests.
      Progress: the guard, deny rule and eval cases now also block
      `k3d cluster delete` (#133); the `minikube delete` rule stays until #157.
- [ ] Remove Minikube from `.mise.toml`, the README, the guides and ADR
      references that describe current behaviour.

### Exit Criteria

- `grep -ri minikube tools/kore/src infra` finds nothing.

## Step 7: Live Proof

### Work

- [ ] Run every opt-in integration suite on k3d.
- [ ] Record the machine load before and after as the outcome of this change.

### Exit Criteria

- `kore local up` converges on the first run from a fresh profile and from an
  existing one.

## Results

Live proof in progress on scratch branch `scratch/k3d-live-proof` (issue #149);
no suite has passed yet. No Minikube baseline exists (#134 closed as not
planned), so only k3d load is recorded.

- Machine: 12 CPUs, Docker VM 11.68 GiB. Before the first `kore local up`:
  load average 4.22 (1 min), 73.8% idle CPU, no containers running.
- Run 1 (fresh profile) failed naming its cause: `oci-registry` PVC unbound
  because the local-path provisioner rejects `Immediate` binding ("no node was
  specified"). Fixed on #269: `kore-standard` and `kore-retained` use
  `WaitForFirstConsumer`.
- `kore local down --prune` left `~/.kore/k3d/kore-local` behind. Fixed on #266:
  deleting the cluster removes that directory only.
- Run 2 (fresh profile, loaded host at load average 166-192): k3s exited with
  `Transaction commit failed` after kine (embedded SQLite) logged "Slow SQL".
  Not reproduced on a quiet host, so no etcd ADR is written.
- Run 3 (fresh profile, quiet host, load 1.7 to 2.6, k3s server container
  2.8 GiB of the 11.68 GiB Docker VM, 83% idle CPU): k3s stayed up for 15
  minutes. `istio-cni-node` never became ready because the chart defaults to
  `/etc/cni/net.d` and `/opt/cni/bin`, which k3s does not use. Fixed on #266 by
  a local overlay pointing at `/var/lib/rancher/k3s/agent/etc/cni/net.d` and
  `/var/lib/rancher/k3s/data/cni`.
- Run 4 (resume): `kore-observability-config` timed out on the `tempo-storage`
  claim. Owner decision, ADR 0086: the claim stays in that release and the
  release sets `helm.wait: false` (`--wait=hookOnly`); Tempo's readiness proves
  the volume. Live run 5 showed Helm 4 turns `--rollback-on-failure` back into a
  resource wait, so that flag is omitted for the opt-out component (fixed, ADR
  0086 updated).
- Run 6 (resume, quiet host, load 2 to 14 during installs): the observability
  phase converged, then `local up` stopped at the local image signer:
  `kubeconfig context k3d-kore-local embeds credentials`. k3d writes client
  certificate data inline, and `minifiedKubeconfig` (ADR 0015) refuses any
  kubeconfig with `-data`, so the signer cannot give cosign a pinned context.
  Blocked on a design decision about how cosign reaches the cluster without
  writing credentials to disk.
- Run 7 (fresh profile, quiet host, load rising to 25-30 from k3d's own VM
  during install): converged through the reference app's image push after four
  more fixes on #266 (cosign kubeconfig through a file descriptor, ADR 0087;
  registry `X-Forwarded-Proto` and a pod roll on proxy config change; the
  locally built image named by the registry address; a digest name for the
  pushed image in the node). The first fresh run then stopped at the admission
  gate: `kore status`'s read-only wait is `STATUS_TIMEOUT = "3s"`
  (`tools/kore/src/platform/readiness.ts`), and `kubectl wait --for=condition=Established
crd/fakes.generators.external-secrets.io --timeout=3s` missed it under load.
  Targeted fix: that one wait retries once at 15s, only when kubectl reports a
  timeout. The broader fix is PR #119 (probe and status-wait tolerance), which
  stays unmerged.
- Run 8 (existing profile, resumed after the failed fresh run above): `kore local up`
  converged in 631s, exit 0. This is the only passing rerun so far.
- Run 9 (fresh profile, 2679s, load 20-30 with 15-40% idle CPU, then a spike to
  186 for ten minutes): k3s exited with `Transaction commit failed` from kine
  (embedded SQLite) at the end of the install, after 146 "Slow SQL" lines, and
  Docker restarted it. `kore local up` then failed on the `reference-db` wait
  because the API vanished. This is the second kine crash during a fresh
  install, so the etcd decision (`--cluster-init`) is now needed; no ADR is
  written yet and no suite has run.
- Safety pattern: expand and contract. Not yet proven live.
