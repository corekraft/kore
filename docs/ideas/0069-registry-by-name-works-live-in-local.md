---
summary: registry-by-name works live in local
hypothesis: registry-by-name works live in local with its by-name path and no port forward
expected-outcome: the names run passes with the flag on
measurement: live run record on corekraft/kore#1225
safety-pattern: feature-flagged
date: 2026-11-21
issue: 1225
outcome: confirmed
---

# Idea 0069: registry-by-name works live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: registry-by-name
- Environment: local
- Lock: main
- Charts: opa-authorizer=0.0.0-e22e1a50faa7@sha256:f600ef2076d882d1cacb21591f28091908dd66404553dbf53147190e21e12f61; kore-postgresql-api=0.0.0-cb3a531ea6ac@sha256:1fa02f3d4531f1fd509470a59416cb6b56ff83bbae53cfcbefc97ebd8be640d5; kore-policy-templates=0.0.0-b8f4944fd4f4@sha256:004a864043849aef1951fc17981388fc92902cfd736c1669423bba0e03de7135; kore-policy-constraints=0.0.0-707481e34bb1@sha256:c8f9737dd84a9abace5556be99d49b33cfbbb3bb26dc819a8f8910bc056be80e; kore-policy-sync=0.0.0-600b67d4a009@sha256:d77f71fb4a367f6c02bba61fa76e5b7a27af78a580fa1269c4b4b8a5026c2fde; kore-hostname-ownership-templates=0.0.0-505b861b5c46@sha256:575b6f371770a1b5a3d8de7dee3e8da884a708ee20f07fee8a761b3173f2c886; kore-hostname-ownership=0.0.0-27e7f1b7989c@sha256:2e385470530dea876cc811570ddb31e3146995b797707fd86c000f7d5c689973; kore-local-tls=0.0.0-1767c1d02a62@sha256:df370c161aea3dc91614e53e9eb189f90f317819b33e26d6c31d402dc27b540b; kore-platform-config=0.0.0-e558fa6e6f20@sha256:ae367bbe6a82aa8c934b71711189aab236f7f43ec813d5435ee19a3a9fd23ba9
- Evidence: https://github.com/corekraft/kore/issues/1225#issuecomment-7054075779
- Recorded: 2026-11-21

Names run green on main 2da0f0de: registry push, sign and cosign verify by name, digest lookup and prune by name. Owner approved recording and activation on 2026-11-21.
