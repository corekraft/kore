---
status: accepted
summary: The local Minikube tunnel is recovered on demand by the commands that need the Gateway endpoint, and reported as degraded with a remedy by status; no supervisor process is added.
date: 2026-11-08
last-verified: 2026-11-08
last-verified: 2026-11-09
---

# ADR 0060: Recover the local tunnel on demand, not with a supervisor

Source: [`infra/plans/2-implementation.md` § Step 8](../../infra/plans/2-implementation.md)

Refines: [ADR 0013](0013-local-tls-before-gateway.md) (the tunnel exposes the
Gateway it created); the plan's tunnel item already covered start, stale
replacement, and stop/destroy cleanup, and left restart after exit open.

## Context

`minikube tunnel` is a detached host process. When it exits (sleep, a killed
terminal session, a Minikube restart) the Gateway `LoadBalancer` loses its
address and nothing starts the process again. kore is a CLI that runs and
exits, so any restart has to come from a command the user runs or from a second
long-lived process kore would own.

## Decision

Recovery is **on demand**; there is no supervisor.

- **Detect.** `tunnelStatus` already calls a tunnel `stale` when its PID is
  dead or its Gateway port does not answer, and `missing` without a state file.
- **Report.** `kore platform status` adds a read-only `local-tunnel` row and
  `kore app status` adds a `tunnel` field. Either is `degraded` for a `stale` or
  `missing` tunnel, and the detail names the remedy (`kore tunnel start
  --environment local`). Status never starts a process.
--environment local`). Status never starts a process.
- **Recover.** `ensureLocalTunnel` is `startLocalTunnel` for a local
  environment: a healthy tunnel is returned untouched, a stale one is stopped and
  replaced, and exactly one new process is started. `kore app up` calls it after
  the platform and admission checks and before any install, so a missing Gateway
  still reports the platform problem rather than a tunnel timeout.
  `kore platform up` and `kore tunnel start` already did this.
- **Stopped profile.** Recovery runs behind the cluster check, so a stopped
  profile raises the cluster-unavailable error and spawns nothing.
- **Cleanup.** `platform stop` and `platform destroy` keep stopping the tunnel
  and removing its state file; there is no second process to clean up.
- **Seams.** Spawn, liveness, port, and termination stay in
  `TunnelDependencies`; the platform and app domains receive the tunnel through
  their public entry points (`ensureTunnel` option on `appUp`).

## Alternatives considered

- **Detached supervisor with backoff.** Restarts a dead tunnel within seconds,
  but it is a second state file, a second orphan to find and kill, a crash loop
  to bound, and it can fight a user who ran `kore tunnel stop`. It needs its own
  liveness and stale-PID handling, doubling the surface this ADR keeps small.
  Rejected because every command that needs the endpoint can restore it.
- **Restart from `kore status`.** Rejected: status is read-only.

## Consequences

- A tunnel that dies between commands stays down until the next `app up`,
  `platform up`, or `tunnel start`; `status` says so. Direct `curl` of the
  Gateway fails until then, which is the accepted cost of having no daemon.
- Stale-PID replacement signals a recorded PID only while it is alive; a
  recycled PID could be signalled. The state file stores no process identity.
  Adding one (start time or command line) is a follow-up if this is ever seen.
  Orphan cleanup (below) never signals by pid alone.

## Process group

The tunnel is spawned detached, so it leads its own process group, and stop,
stale replacement, and a failed start signal `-pid` (the group). Signalling
only the leader left minikube's `ssh -L` child alive and holding the Gateway
port. Group signalling still runs only while the recorded leader is alive.

## Orphans

A live run showed that when the leader dies (killed or crashed) its `ssh -L`
child survives, can keep holding Gateway port 8443, and orphans accumulate.
Signalling the group only while the leader is alive cannot reach them, so this
ADR reverses the earlier "recorded PID only" cleanup:

- **Match by command line.** On stop, destroy, stale replacement, and a start
  with no recorded tunnel, kore lists host processes (`ps`) and terminates each
  whose full command line is an `ssh` with this profile's machine key under
  `/.minikube/machines/<profile>/` and `-L` forwards for the Gateway port and
  15021. Matching is on the command line, never on a pid. Another profile, a
  longer profile name, or any other ssh does not match. Each kill is reported
  in one line; nothing to kill prints nothing.
- **Not matched: the ssh port.** The profile's ssh port is known only from the
  cluster (`docker port`/`minikube ssh-host`), and cleanup runs when the
  cluster may be stopped, so the key path is the profile identity instead.
- **Registry port-forward.** `ensurePortForward` starts a detached
  `kubectl --context <ctx> --namespace kore-registry port-forward
service/oci-registry 30500:5000` that was never ended. `platform stop` and
  `platform destroy` (so `local down`) now terminate it by that exact command
  line for the environment's context; a forward for another context or any
  other kubectl is left alone, and with none running it does nothing.
- **Seams.** `runtime/processes.ts` provides `listProcesses`, `signalProcess`,
  and `report` (`ProcessControl`); the unit-test setup stubs the host listing
  empty so no test can see or signal a real process.

## Verification

Unit tests inject the spawn, liveness, port, and terminate seams. The live run
kills the tunnel with `kill "$(jq .pid .kore/state/local.tunnel.json)"` (or
`pkill -f "minikube tunnel --profile kore-local"`), expects `kore platform
status` and `kore app status reference` to show `local-tunnel` degraded with the
remedy, then runs `kore app up reference --environment local` (or `kore tunnel
start --environment local`) and expects a new PID in the state file, one
`minikube tunnel` process, and `curl -k https://127.0.0.1:8443/api` answering.
Finally `kore platform stop` must leave no `minikube tunnel` process and no
state file.
`minikube tunnel` process, and `curl --cacert <kore CA> --resolve kore.local:8443:127.0.0.1
https://kore.local:8443/api` answering (no `-k`: the Gateway routes by SNI, so a
bare `https://127.0.0.1:8443` is refused with `000`).
Finally `kore platform stop` must leave no `minikube tunnel` process, no
`ssh -L 15021` child (`pgrep -f "ssh.*15021"` is empty), no `kubectl ...
port-forward service/oci-registry` process, and no state file. Kill the leader
alone (`kill <pid>`), run `kore tunnel start`, and expect one line naming the
orphaned ssh forward killed and exactly one ssh forward afterwards.
