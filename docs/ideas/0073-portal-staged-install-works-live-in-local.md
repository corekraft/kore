---
summary: portal-staged-install works live in local
hypothesis: portal-staged-install starts Keycloak and Backstage only after the Argo CD Applications are Synced and Healthy and keeps the k3s API server CPU peak low
expected-outcome: the staged order holds, kore local up converges with the portal on, no OOMKilled pod and no API timeouts
measurement: live run records on corekraft/kore#1318
safety-pattern: feature-flagged
date: 2026-11-21
issue: 1318
outcome: confirmed
---

# Idea 0073: portal-staged-install works live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: portal-staged-install
- Environment: local
- Lock: main
- Charts: opa-authorizer=0.0.0-e22e1a50faa7@sha256:f600ef2076d882d1cacb21591f28091908dd66404553dbf53147190e21e12f61; kore-postgresql-api=0.0.0-cb3a531ea6ac@sha256:1fa02f3d4531f1fd509470a59416cb6b56ff83bbae53cfcbefc97ebd8be640d5; kore-policy-templates=0.0.0-b8f4944fd4f4@sha256:004a864043849aef1951fc17981388fc92902cfd736c1669423bba0e03de7135; kore-policy-constraints=0.0.0-707481e34bb1@sha256:c8f9737dd84a9abace5556be99d49b33cfbbb3bb26dc819a8f8910bc056be80e; kore-policy-sync=0.0.0-600b67d4a009@sha256:d77f71fb4a367f6c02bba61fa76e5b7a27af78a580fa1269c4b4b8a5026c2fde; kore-hostname-ownership-templates=0.0.0-505b861b5c46@sha256:575b6f371770a1b5a3d8de7dee3e8da884a708ee20f07fee8a761b3173f2c886; kore-hostname-ownership=0.0.0-27e7f1b7989c@sha256:2e385470530dea876cc811570ddb31e3146995b797707fd86c000f7d5c689973; kore-local-tls=0.0.0-d7527b54a884@sha256:821e45a1c7d82a08be236d03880f05d43544f00952eda2e6cc4d8cbbbcc1865b; kore-platform-config=0.0.0-d10c0f0fe043@sha256:00b70faca9abe43bf5cf2614d87cd6bbaa014d9daf052fa40746ee3c0fac3741
- Evidence: https://github.com/corekraft/kore/issues/1318#issuecomment-7069229653
- Recorded: 2026-11-21

Run j on main cdb6be38 with platform-portal and portal-staged-install on: kore local up converged (EXIT 0) with the portal installed after the Applications were Healthy; no OOMKilled pod; Docker memory peak 14.7 of 39.2 GiB. Earlier runs on #1318 recorded the staged order and the k3s CPU peak. The owner approved the activation on 2026-11-21.
