---
status: accepted
summary: An explicit, resumable `kore registry rotate-credentials --yes` replaces the registry's push and read passwords and the enrolled namespaces' pull Secrets in an order that keeps admission reading signatures throughout; nginx needs no reload.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0055: Rotate the registry credentials with an ordered, resumable command

Source: [`infra/plans/2-implementation.md` § Step 7](../../infra/plans/2-implementation.md)

Refines: [ADR 0034](0034-registry-authentication-and-authorization.md) (its
"reused, never rotated" credentials now have a rotation path).

## Context

ADR 0034 reuses credentials and leaves rotation to deleting both Secrets and
rerunning `kore platform up`. After a suspected leak that was the only option,
and it left a window in which every enrolled namespace's `kore-registry-read`
Secret was wrong, so Policy Controller could not read signatures and admission
failed closed. The proxy offers no overlap: nginx's `auth_basic` stops at the
first htpasswd line whose username matches, so two passwords for one username
cannot both be valid.

## Decision

`kore registry rotate-credentials --environment <name> --yes` is a mutating
command: named environment, configured context, environment lock, journal. It
refuses without `--yes` and for an external registry (the provider owns those
credentials). It generates both passwords in memory (256 bits each), streams
every Secret through stdin, prints nothing secret, and redacts old and new
passwords from errors with `withSecretsRedacted`.

Order, and why:

1. **Apply both Secrets with the new read identity under a new username**
   (`kore-read-<random>`), keeping every earlier read line in the htpasswd.
   Different usernames are the overlap nginx lacks: old and new read
   credentials are both valid. The nginx rule forbids writes for any name but
   `kore-push`, so the new name stays read-only. The new passwords are
   persisted here, before anything depends on them. The old push identity ends
   here; only kore uses it, serialized by the environment lock.
2. **Wait until the proxy serves that file.** The htpasswd Secret is a
   directory mount, which the kubelet syncs into the pod (about a minute).
   kore reads `/etc/nginx/auth/htpasswd` back from the proxy container (hashes
   only) and compares it, with a bounded poll that names the cause on timeout.
3. **Replace each enrolled namespace's pull Secret**, one apply per namespace.
   Whether a namespace holds the old or the new read credential, the proxy
   accepts it, so admission keeps access mid-way.
4. **Drop the earlier read lines and wait again**, so when the command returns
   the old passwords get 401.

The pull Secrets move only after step 2 and the old read line goes only after
step 3. Reversing either would deny reads.

**Resume.** A rerun reads the htpasswd, retains every `kore-read*` line it still
holds, and rotates again, so a namespace stranded on an earlier read credential
keeps working until a run completes. `kore platform up` rewrites the htpasswd
from the credentials Secret alone and would drop the extra lines; rerun the
rotation to recover.

**No reload.** nginx opens `auth_basic_user_file` on every request, so the
proxy needs neither a reload nor a restart; only the kubelet sync matters.
This is checked by the live integration spec, not the fast tests.

## Consequences

- The read username changes at each rotation. Every consumer reads it from the
  credentials Secret, so nothing else changes.
- Rotation takes about two kubelet syncs (two to three minutes).
- Running pods keep their image pulls: kubelet pulls need no credential locally.
- A leak of the push credential is closed at step 1; a leak of the read
  credential is closed at step 4.
- The live check is
  `mise exec -- npm --prefix tools/kore run test:integration:registry`
  (`registry.integration.spec.ts`) against a running local profile.
