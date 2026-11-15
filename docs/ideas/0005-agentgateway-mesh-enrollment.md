---
summary: Enrol agentgateway in the mesh
hypothesis: The identity chain holds behind agentgateway, already tested live on kore-local.
expected-outcome: The identity spec passes and the reference spec passes behind agentgateway.
measurement: The live identity and reference specs recorded on issue 208.
safety-pattern: feature-flagged
date: 2026-11-15
issue: 208
outcome: confirmed
---

# Idea 0005: Enrol agentgateway in the mesh

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: agentgateway-mesh-enrollment
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/208#issuecomment-6897416557
- Recorded: 2026-11-15

Live identity spec passed 7 with 1 skipped and the reference spec passed 8 on kore-local.
