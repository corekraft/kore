---
summary: platform-argocd-delivery works live in local
hypothesis: With platform-argocd-delivery on in local, kore local up converges from a fresh and an existing profile, Argo CD delivers every platform configuration release and the golden-path service by signed digest, and the admission gate opens.
expected-outcome: kore local up exits 0 from a fresh and an existing profile, every Application Synced and Healthy, golden-path-golden-path-example delivered by digest, Gateway reachable over HTTPS, VM memory under 85 percent, no OOMKilled.
measurement: Live runs f and g recorded on issue 1110 (comments 7001628779 and 7001865127): both exit 0, 7 Applications Synced and Healthy, VM memory 59 percent used, no OOMKilled.
safety-pattern: dark-launched
date: 2026-11-19
issue: https://github.com/corekraft/kore/issues/1306
outcome: confirmed
---

# Idea 0047: platform-argocd-delivery works live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: platform-argocd-delivery
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/1110#issuecomment-7001865127
- Recorded: 2026-11-19

Live runs f and g on a throwaway local profile: kore local up exit 0 from a fresh and an existing profile, 7 Applications Synced and Healthy, the golden-path service delivered by signed digest, Gateway reachable over HTTPS, VM memory 59 percent used, no OOMKilled.
