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

- [x] Change the provider value to `k3d` in the config types, schema and
      `infra/environments/local/environment.yaml`.
      Progress: types, schema and validator accept `k3d` (with an
      `environment.k3d` block), `managed` and `minikube` (#136); the overlay
      flipped in #146 (ADR 0085) and was proven live in #149; `kore doctor` checks the pinned `k3d` and `docker` and the
      cluster before anything mutates.
- [x] Rewrite `cluster/` for `k3d cluster create`, `start`, `stop` and
      `delete`, with Traefik and ServiceLB disabled and ports mapped through
      the k3d load balancer.
- [x] Keep the readiness wait from ADR 0065 against the k3s API server.
      Progress: `clusterUp` creates or starts the k3d cluster, then runs the
      wait against the configured context; `clusterStatus` and
      `assertExpectedCluster` handle k3d (#138). `clusterStop` and
      `clusterDestroy` handle k3d with the same consent and data gates (#143);
      the lifecycle was proven live in #149 (four fresh and three existing
      profile runs, stop/start, destroy).

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

- [x] Delete the `tunnel` domain, its commands, status row and specs.
- [x] Route Gateway traffic through the k3d load balancer.
      Progress: the overlay publishes the Gateway Service as a NodePort the
      load balancer maps from host 8443, and `platform up` starts no tunnel on
      k3d (#146, [ADR 0085](../../docs/decisions/0085-k3d-gateway-answers-through-a-node-port.md));
      #149 proved it live: the Gateway answered after a stop/start with no
      tunnel process.
- [x] Mark ADR 0060 superseded by ADR 0076.

### Exit Criteria

- The Gateway endpoint answers on the host without a tunnel process.

## Step 5: Storage

### Work

- [x] Point `platform-storage` at the k3s `local-path` provisioner.
- [ ] Re-prove retained-volume discovery (ADR 0061).

### Exit Criteria

- The storage lifecycle integration suite passes on k3d.

## Step 6: Retire Minikube

No live suite runs on Minikube any more (#134 recorded no Minikube baseline),
and #152 removed the Minikube provider from the CLI code: a `minikube` provider
is rejected at validation. What remains is the tool pin, the docs, the guard
and the clean-machine script (#157).

### Work

- [ ] The operator runs `minikube delete -p kore-local` once, by hand.
- [x] Move the `minikube delete` deny rule to `k3d cluster delete`, and update
      the guard and its tests.
      Progress: the guard, deny rule and eval cases blocked
      `k3d cluster delete` from #133; #157 removed the `minikube delete` rule
      (through the guardrail inventory and `guardrail deny --write
      --allow-removal`) and its guard cases, as this step approved. The
      `k3d cluster delete` rule stays.
- [x] Remove the `minikube` provider value from the types, schema and validator,
      and the Minikube paths from the cluster, local and doctor code.
      Progress: done in #152; a `minikube` provider is now rejected with a
      message pointing at k3d. The pin, README, guides and guard stay to #157.
- [x] Remove Minikube from `.mise.toml`, the README, the guides and ADR
      references that describe current behaviour.
      Progress: done in #157, with the version catalog and compatibility
      matrix. The README states that existing Minikube data is abandoned and
      how to delete the old profile by hand. ADRs 0012, 0015, 0058 and 0065
      now describe k3d; ADR 0076 stays accepted.

### Exit Criteria

- `grep -ri minikube tools/kore/src infra` finds nothing, apart from ADR
  filenames and two recorded exceptions: the provider rejection in
  `tools/kore/src/config/validate.ts` (and its spec), and the provider-name
  detector in `tools/kore/src/diagnostics/portability.ts` (and its spec).

## Step 7: Live Proof

### Work

- [x] Run every opt-in integration suite on k3d.
- [x] Record the machine load before and after as the outcome of this change.

### Exit Criteria

- `kore local up` converges on the first run from a fresh profile and from an
  existing one.

## Results

Live proof on scratch branch `scratch/k3d-live-proof` (issue #149), 12-CPU
host, Docker VM 11.68 GiB, 2026-11-12. No Minikube baseline exists (#134 closed
as not planned), so only k3d load is recorded.

### Convergence

- **Fresh profile, first run:** `kore local up` converged four times from an
  absent cluster (1169s on a quiet host, 1225s, 1298s inside the README quick
  start, 1376s); k3s restarted 0 times and logged at most 8 "Slow SQL" lines in
  each converged run.
- **Existing profile:** a rerun converged three times (252s, 235s, 631s), and
  after a stop (`kore local down`, data kept) `kore local up` restored the
  Gateway in 312s.
- **Gateway after stop/start:** before the stop the Gateway answered on
  `kore.local:8443` (HTTP 403 from the platform's authorizer, the expected
  answer). While stopped, every k3d container was down and the port refused.
  After `up` it answered again three times, with 0 tunnel processes; port 8443
  is held only by Docker's forwarder.

### Opt-in suites (one at a time, under the integration lock)

| Suite                                       | Result                                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| storage                                     | 1/1                                                                                                                                            |
| gateway                                     | 3/3                                                                                                                                            |
| admission                                   | 6/6                                                                                                                                            |
| signer                                      | 1/1                                                                                                                                            |
| identity                                    | 7 passed, 1 skipped by design (needs `kore-workload-identity` promoted; the policy suite proves that round trip)                               |
| policy                                      | 1/1                                                                                                                                            |
| ops                                         | 1/1 (needs `KORE_OPS_AGE_IDENTITY`; skipped without it)                                                                                        |
| registry                                    | 4/4                                                                                                                                            |
| telemetry                                   | 3/3 (needs `reference` traffic first)                                                                                                          |
| gate                                        | 1/1                                                                                                                                            |
| reference                                   | 8/8                                                                                                                                            |
| resilience                                  | 10/10 on the second run; the first run failed because the policy-controller webhook was restarted by its 1s probes under load (see Open items) |
| docs                                        | 2/2                                                                                                                                            |
| cluster                                     | 1/1 (destroys and recreates `kore-local`)                                                                                                      |
| lifecycle                                   | 1/1                                                                                                                                            |
| README quick start (platform default group) | 3/3                                                                                                                                            |
| clean-machine                               | passed (1487s)                                                                                                                                 |

Out of scope for #149: app-status, promotion, helm-interrupt and upgrade, to be
proven when their own PRs (#114, #116, #117) land.

Suite order matters and is not a defect: `signer` swaps the signing key, so the
reference image needs a `kore local up` before `policy`; `telemetry` needs
`reference` traffic first; `cluster` destroys the cluster, so `lifecycle` needs
a fresh `up` after it.

### Machine load (k3d only)

- Idle host before the first `up`: load average 4.2, 73.8% idle CPU, no
  containers.
- Quiet fresh run (load 1.6 at the start): load average 5.8 on average, 9.6
  peak; k3s server memory 3.7 GiB on average and 6.7 GiB peak of the 11.68 GiB
  Docker VM, CPU up to about 11 cores during installs; host CPU 15-50% idle
  during install, 50-76% idle once settled. The macOS host held 4-8 GiB of swap
  throughout.
- Between suites with the platform settled: k3s server about 0.7-3 cores and
  5-7.7 GiB of memory; load average 7-16.

### Safety pattern and fallbacks

- Safety pattern: expand and contract. The k3d environment was added beside
  Minikube (provider `k3d`), proven live, and Minikube is retired in Step 6.
- ADR 0084 restart fallback: not needed. The CA is written after the node
  starts, and a `crictl pull` without credentials reached the registry over TLS
  and failed with `authorization failed`, not an x509 error.
- ADR 0085 (Gateway NodePort): worked; the Gateway answers through the load
  balancer with no tunnel.
- ADR 0086 (resources-only releases do not wait on claims that bind later) and
  ADR 0087 (cosign reads the pinned kubeconfig from a file descriptor) were
  added during the proof.

### Found live and fixed on this branch or #269

`WaitForFirstConsumer` storage classes (local-path cannot bind without a node);
prune removes `~/.kore/k3d/<cluster>`; istio-cni uses the k3s CNI directories;
`helm.wait: false` for `kore-observability-config` (no rollback flag, because
Helm 4 turns it back into a wait); cosign reads the kubeconfig through a file
descriptor; the registry proxy sends `X-Forwarded-Proto: https` and the pod
rolls on a proxy config change; the built image is named by the registry
address and by digest in the node; the 3s status wait retries once at 15s
(#119 is the broader fix, left unmerged); and spec fixes found by the live
suites (resilience pre-check ignores gated-off components, the quick start
stops a tunnel only on Minikube, the persistence spec polls through an empty
primary list, two unit specs no longer assume an unset opt-in or lock
variable, the clean-machine status check judges platform components only).

### Decisions and follow-ups

- **Minikube retired (#157).** The tool pin, catalog entry, guard case, deny
  rule, eval cases, README, guides and the clean-machine script (k3d only, with
  `kore local down --prune --purge-data` as its teardown) no longer carry
  Minikube. What remains by design: ADR filenames and history, the provider
  rejection in `config/validate.ts`, and the provider-name detector in
  `diagnostics/portability.ts` (both with their specs). The operator's one-time
  `minikube delete -p kore-local` is still theirs to run and tick.

- **k3s datastore stays SQLite (owner decision).** Known limit: kine (embedded
  SQLite) crashed twice with `Transaction commit failed` during fresh installs
  while the host load was above 100 (one run with other sessions busy, one with
  a 186 load spike); four later fresh runs on a quieter host did not crash.
  The documented fallback, if it recurs, is embedded etcd (`--cluster-init`),
  recorded as an ADR at that point. `kore doctor` reports no host load or
  memory for k3d, so this is documentation only.
- **policy-controller probes:** the upstream chart (0.10.8) exposes no probe
  settings and its webhook probes use a 1s timeout, so under load the
  controller can be restarted and admission briefly has no endpoint. #292 patches
  the probes to a 5s timeout through a Helm post-renderer (ADR 0089); the live
  proof (`resilience` passing first time under the suite's load) remains.
- **crd-ownership on k3d:** `addons.k3s.cattle.io`,
  `etcdsnapshotfiles.k3s.cattle.io`, `helmchartconfigs.helm.cattle.io` and
  `helmcharts.helm.cattle.io` ship with k3s and no catalog component owns them.
  The local overlay declares `k3s.cattle.io` and `helm.cattle.io` in
  `providerOwnedCRDGroups`, so the row counts them as provider-owned (#291,
  ADR 0088). A live `kore status` on k3d is still to confirm the row is
  healthy.
- **backups row** reports degraded on a fresh install with retained data and no
  export, by design; `kore data export` clears it.
