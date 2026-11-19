---
summary: platform-shared-gateway works live in local
hypothesis: With platform-shared-gateway on in local, kore local up converges from a fresh profile and when the flag is flipped on over an existing profile, the shared Gateway is Programmed, routes from platform-labelled namespaces are Accepted and answer over HTTPS by name with the trusted local CA, and a route from an unlabelled namespace is refused without breaking existing routes.
expected-outcome: kore local up exits 0 fresh, on the flip and on an unchanged rerun; Applications Synced and Healthy; Gateway Accepted and Programmed; platform-labelled routes Accepted; HTTPS by name 200 verified against the local CA; an unlabelled namespace route Accepted=False NotAllowedByListeners; VM memory under 85 percent; no OOMKilled.
measurement: Live runs 1210-g and 1210-h recorded on issue 1210.
safety-pattern: dark-launched
date: 2026-11-19
issue: https://github.com/corekraft/kore/issues/1359
outcome: confirmed
---

# Idea 0049: platform-shared-gateway works live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: platform-shared-gateway
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/1210#issuecomment-7024514586
- Recorded: 2026-11-19

Live runs 1210-g and 1210-h on a throwaway local profile: kore local up exit 0 fresh, on flipping the flag over a flags-off profile, and on an unchanged rerun; 7 to 10 Applications Synced and Healthy; shared Gateway Accepted and Programmed with named ports; platform-labelled routes Accepted; golden-path-example by name returns 200 verified against the local CA; an unlabelled namespace route is Accepted=False NotAllowedByListeners and existing routes keep answering; VM memory peak 67 percent; no OOMKilled. Scope: the host system resolver and Backstage and Keycloak by name are not part of this flag and are not claimed (#1357, #1358).
