---
summary: The golden-path sign-in passes live: a signed-in call succeeds and an anonymous call is refused
hypothesis: With golden-path-signin on, a Service delivered by the golden path signs a user in through Keycloak, answers a signed-in call, and refuses a call with no sign-in
expected-outcome: npm run test:live:golden-path-signin passes on a delivered Service with golden-path-signin on in local
measurement: live run recorded on corekraft/kore#1747
safety-pattern: feature-flagged
date: 2026-11-22
issue: 1747
outcome: confirmed
---

# Idea 0080: The golden-path sign-in passes live: a signed-in call succeeds and an anonymous call is refused

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: golden-path-signin
- Environment: local
- Lock: main
- Charts: opa-authorizer=0.0.0-e22e1a50faa7@sha256:f600ef2076d882d1cacb21591f28091908dd66404553dbf53147190e21e12f61; kore-postgresql-api=0.0.0-cb3a531ea6ac@sha256:1fa02f3d4531f1fd509470a59416cb6b56ff83bbae53cfcbefc97ebd8be640d5; kore-policy-templates=0.0.0-b8f4944fd4f4@sha256:004a864043849aef1951fc17981388fc92902cfd736c1669423bba0e03de7135; kore-policy-constraints=0.0.0-707481e34bb1@sha256:c8f9737dd84a9abace5556be99d49b33cfbbb3bb26dc819a8f8910bc056be80e; kore-policy-sync=0.0.0-600b67d4a009@sha256:d77f71fb4a367f6c02bba61fa76e5b7a27af78a580fa1269c4b4b8a5026c2fde; kore-hostname-ownership-templates=0.0.0-505b861b5c46@sha256:575b6f371770a1b5a3d8de7dee3e8da884a708ee20f07fee8a761b3173f2c886; kore-hostname-ownership=0.0.0-27e7f1b7989c@sha256:2e385470530dea876cc811570ddb31e3146995b797707fd86c000f7d5c689973; kore-local-tls=0.0.0-d7527b54a884@sha256:821e45a1c7d82a08be236d03880f05d43544f00952eda2e6cc4d8cbbbcc1865b; kore-platform-config=0.0.0-d10c0f0fe043@sha256:00b70faca9abe43bf5cf2614d87cd6bbaa014d9daf052fa40746ee3c0fac3741
- Evidence: https://github.com/corekraft/kore/issues/1747#issuecomment-7078559209
- Recorded: 2026-11-22

Runs on kore-agents, 2026-11-22, code 78553ce9 (charts-main lock of that commit, release v0.22.0 template lock), delivery-probe in local with golden-path-signin on in a throwaway overlay. npm run test:live:golden-path-signin passed: signed-in call 200 on the Service host, request with no sign-in refused with a 302 to /oauth2/authorization/golden-path. Four fixes were needed first and are merged: the secret key (#1822), CA trust (#1827), https redirect (#1836), one BFF replica while sign-in is on (#1837). Limit: while the flag is on the BFF has no high availability and does not scale out until the shared session store (#1841). The owner approved recording and activation on 2026-11-22.
