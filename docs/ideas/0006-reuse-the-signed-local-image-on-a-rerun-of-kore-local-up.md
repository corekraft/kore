---
summary: Reuse the signed local image on a rerun of kore local up
hypothesis: With local-image-reuse on, a rerun reuses the signed reference image so the reference Helm release does not move.
expected-outcome: An immediate rerun leaves the reference revision and digest unchanged.
measurement: Two kore local up runs on a throwaway profile.
safety-pattern: feature-flagged
date: 2026-11-16
issue: 344
outcome: confirmed
---

# Idea 0006: Reuse the signed local image on a rerun of kore local up

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: local-image-reuse
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/344#issuecomment-6906796220
- Recorded: 2026-11-16

With local-image-reuse on, an immediate rerun left the reference revision and image digest unchanged across 31 releases diffed.
