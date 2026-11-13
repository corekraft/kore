---
status: proposed
summary: A nightly job proves clean local up and the integration suites on a dedicated host, commands get a read and a mutation timeout, and the runner choice stays an open owner decision.
date: 2026-11-12
last-verified: 2026-11-12
---

# ADR 0093: The nightly live proof runs on a dedicated self-hosted runner under bounded timeouts

Source: [issue #339](https://github.com/corekraft/kore/issues/339), spec [#333](https://github.com/corekraft/kore/issues/333)

## Context

CI `check` never starts a cluster, so `kore local up` from clean and the
opt-in integration suites ran only by hand (retro finding 6). A hung `helm`,
`kubectl` or suite also held its caller until an outer limit, with no named
cause. A k3d cluster with the platform stack needs more memory than a standard
GitHub-hosted runner has, and the nightly purges the `kore-local` profile.

## Decision

**Nightly live proof.** `nightly.yml` runs once a night on main:
`tools/kore/scripts/nightly.sh` purges any old profile, runs `local up`,
checks platform status, runs `local up` again, runs every `test:integration*`
suite against that one cluster, and purges last (an EXIT trap). A failing suite
does not hide later ones, and a failed `local up` skips the suites. The run's
conclusion is the status on main; the workflow holds read-only permissions, so
the signer permission guard is unchanged.

**Timeouts.** `ProcessRunner` kills a command that runs past its timeout:
SIGTERM to its process group, then SIGKILL to the group after a grace period.
It settles on the child's exit plus the grace period, not on pipe close, and
reports "did not exit on SIGTERM" only when that happened. The default is 30
minutes, for reads and everything else. A helm mutation gets its own deadline:
twice its `--timeout` plus a two-minute margin, because a failed upgrade rolls
back and waits again. Every kubectl read verb (not only `get`) carries
`--request-timeout=30s`; watches and followed logs do not.

**Runner trust boundary.** The nightly runs repository code with the host's
Docker and filesystem, so the runner must be:

- a dedicated host, because the nightly purges `kore-local`;
- in an organization runner group limited to `nightly.yml@refs/heads/main`;
- ephemeral, a fresh runner for each job;
- behind the repository setting that requires approval for fork workflows.

**Open owner decision: the runner.** Use a self-hosted runner labelled
`kore-nightly` (the workflow's current `runs-on`) or a larger GitHub-hosted
runner. A larger hosted runner needs no trust boundary of its own but costs
money, and its memory must be shown to fit the platform. Until the owner picks
and provisions one, the nightly job queues.

## Consequences

- Live regressions surface within a day rather than at the next manual run.
- `nightly.sh` needs GNU `timeout` (Linux; `gtimeout` from coreutils on macOS)
  and says so when it is missing.
- A slow but healthy mutation longer than twice its helm timeout plus the margin
  is killed and named; raise the component's `timeout` rather than the default.
- Detached children no longer receive the terminal's Ctrl-C, and Node's default
  signal handling ends Kore without an `exit` event. On SIGINT or SIGTERM Kore
  therefore sends SIGTERM to every live child group and exits 130 or 143 (unless
  another handler, such as the integration lock's, is left to decide); a normal
  exit kills any group still running. Children that share the terminal
  (inherited stdin or output) are not detached.
- A night that finds no `test:integration*` suites, or whose discovery fails,
  fails instead of passing green.
- Registering the runner and setting the runner-group, ephemeral and
  fork-approval controls are owner steps; the ADR stays `proposed` until then.
