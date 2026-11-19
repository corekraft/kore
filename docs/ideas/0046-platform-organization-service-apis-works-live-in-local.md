---
summary: platform-organization-service-apis works live in local
hypothesis: With platform-organization-service-apis on in local, the Organization and Service XRDs establish, a registered Service reconciles to Ready, and its namespace carries the organization and tenant labels.
expected-outcome: XRDs Established, Service golden-path-example Ready, namespace golden-path-example--local labelled platform.kore.dev/organization=platform and tenant=platform, VM memory under 85 percent.
measurement: Live run recorded on issue 1108 (comment 6995223732): XRDs established, Service Ready, labels present, VM memory 60.2 percent after.
safety-pattern: dark-launched
date: 2026-11-19
issue: https://github.com/corekraft/kore/issues/1283
outcome: confirmed
---

# Idea 0046: platform-organization-service-apis works live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: platform-organization-service-apis
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/1108#issuecomment-6995223732
- Recorded: 2026-11-19

Live run on a throwaway local profile: Organization and Service XRDs established, Service golden-path-example Ready, namespace golden-path-example--local labelled organization=platform and tenant=platform, VM memory 60.2 percent after, no OOMKilled.
