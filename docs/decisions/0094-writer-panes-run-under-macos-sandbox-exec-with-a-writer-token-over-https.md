---
status: accepted
summary: Refines ADR 0091: a writer pane runs under sandbox-exec that confines writes to its worktree and denies credential reads and the herdr socket; a container is the fallback; it is not a containment boundary until the writer identity exists.
date: 2026-11-12
last-verified: 2026-11-12
---

# ADR 0094: Writer panes run under macOS sandbox-exec with a writer token over HTTPS

Source: [`infra/plans/11-agent-delivery-loop.md` § Current Limits](../../infra/plans/11-agent-delivery-loop.md#current-limits)

Refines: [ADR 0091](0091-containment-comes-from-identities-and-a-sandbox-not-role-guards.md).

## Context

ADR 0091 says writer panes run in an OS sandbox but not which one. A spike on
macOS (Darwin 25.6) probed `sandbox-exec` with a profile that allows everything
except what the writer must not do. It proved that writes outside the worktree
fail, that `~/.ssh`, `~/.kube` and `~/.config/gh` cannot be read, that a
connection to the herdr socket is refused, and that `npm ci` and `git commit`
in the worktree work. Four opt-in specs in
`tools/harness/tests/writer-sandbox.spec.ts` prove the write, read and socket
limits and the commit flow, each against an unsandboxed control.

Two things do not fit. Origin is SSH, so `git push` needs `~/.ssh`. And `gh`
keeps its token in the keychain, which the sandbox must not reach.

## Decision

- A writer pane runs under macOS `sandbox-exec`. The profile confines writes
  to the worktree, this worktree's metadata and the refs, objects and logs of
  the shared `.git`; it denies reads of credential directories and the herdr
  sockets.
- Writer worktrees push over HTTPS with a token helper, reading the writer
  identity's token from `GH_TOKEN` (set by the launcher, with `GH_CONFIG_DIR`
  pointing at an empty directory). The owner's checkout stays on SSH.
- A container (Colima) is the recorded fallback, for when `sandbox-exec` is
  removed or a stronger mount model is needed. It was not tried.
- The sandbox is not called a containment boundary until the writer identity
  from the identity ticket exists. The owner's token is never used to prove the
  push.
- The proving specs run only on macOS with `KORE_SANDBOX_TESTS=1`.

## Consequences

- Limit: the shared `.git` stays writable for refs, so a writer can move other
  branches' refs and add objects. The sandbox cannot scope to one ref; the
  judge identity and branch protection are what stop a bad merge.
- Limit: `sandbox-exec` is deprecated by Apple and macOS-only. A network
  allowance is not restricted: a writer can still reach the network, so the
  token's own permissions are the limit on what it can do remotely.
- Pending: the HTTPS push and `gh pr create` proof under the sandbox, until the
  writer identity token exists. The spike's HTTPS dry-run hung and is unproven.
- Pending: wiring the profile into `session spawn`; this spike adds only the
  profile builder and the specs.
