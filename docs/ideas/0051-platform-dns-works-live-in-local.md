---
summary: platform-dns works live in local
hypothesis: With platform-dns and platform-shared-gateway on in local, kore local up converges from a fresh profile, the installed host resolver answers platform names on loopback, and HTTPS by name verifies against the local CA, while a stopped cluster gives no answer and nothing listens off loopback.
expected-outcome: kore local up exits 0 fresh; scutil --dns shows the platform domain on 127.0.0.1 port 1053; the system resolver returns 127.0.0.1 for a platform name and HTTPS returns 200 with the local CA verified and no --resolve flag; a pod resolves the name to the Gateway address; with the cluster stopped there is no answer and no listener on 8443 or 1053.
measurement: Live runs 1210-g and 1210-j and the stopped-cluster check, recorded on issue 1210.
safety-pattern: feature-flagged
date: 2026-11-20
issue: https://github.com/corekraft/kore/issues/1382
outcome: confirmed
---

# Idea 0051: platform-dns works live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: platform-dns
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/1210#issuecomment-7030146654
- Recorded: 2026-11-20

Scope: the platform domain is kore.local with the resolver file installed by kore dns install. Verified: first-time convergence with platform-dns and platform-shared-gateway on (run 1210-j), the host system resolver (scutil --dns, dscacheutil), HTTPS by name verified against the local CA with no --resolve flag, pod resolution to the Gateway address, loopback-only listeners, and no answer with the cluster stopped (comment 7030192206). Not claimed: the kore.internal default (ADR 0132, #1215 and #1216), Backstage and Keycloak by name (#1358), a flip of the flag on an existing cluster. Advisor reading, not owner approval.
