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
- [ ] Rewrite `cluster/` for `k3d cluster create`, `start`, `stop` and
      `delete`, with Traefik and ServiceLB disabled and ports mapped through
      the k3d load balancer.
- [ ] Keep the readiness wait from ADR 0065 against the k3s API server.

### Exit Criteria

- `kore local up` creates a k3d cluster from nothing, and `kore cluster status`
  reports it.

## Step 3: Images and Registry Trust

### Work

- [ ] Replace `minikube image load` with `k3d image import`.
- [ ] Replace `minikube ssh` CA installation with `registries.yaml` set at
      cluster create.
- [ ] Keep Kore's in-cluster TLS registry as the only registry.

### Exit Criteria

- Signed local images are imported and pulled by digest with
  `imagePullPolicy: Never`.

## Step 4: Remove the Tunnel

### Work

- [ ] Delete the `tunnel` domain, its commands, status row and specs.
- [ ] Route Gateway traffic through the k3d load balancer.
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

Not started.
