---
summary: golden-path-signin-after-portal works live in local on the v0.26.0 locks
hypothesis: a fresh kore local up converges with the golden-path sign-in Applications awaited after the portal starts, on the release charts
expected-outcome: kore local up --require-fresh-lock exits 0 from a purged cluster on v0.26.0 with the flag on
measurement: live run record on corekraft/kore#1880
safety-pattern: feature-flagged
date: 2026-11-24
issue: 1880
outcome: confirmed
---

# Idea 0085: golden-path-signin-after-portal works live in local on the release locks

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: golden-path-signin-after-portal
- Environment: local
- Lock: release
- Charts: opa-authorizer=0.0.0-e22e1a50faa7@sha256:f600ef2076d882d1cacb21591f28091908dd66404553dbf53147190e21e12f61; kore-postgresql-api=0.0.0-8e4902321c78@sha256:16a1519489d982341a62221ee060ec33c6a4dedfa28bf6774150120fb9d621bc; kore-policy-templates=0.0.0-b8f4944fd4f4@sha256:004a864043849aef1951fc17981388fc92902cfd736c1669423bba0e03de7135; kore-policy-constraints=0.0.0-707481e34bb1@sha256:c8f9737dd84a9abace5556be99d49b33cfbbb3bb26dc819a8f8910bc056be80e; kore-policy-sync=0.0.0-600b67d4a009@sha256:d77f71fb4a367f6c02bba61fa76e5b7a27af78a580fa1269c4b4b8a5026c2fde; kore-hostname-ownership-templates=0.0.0-505b861b5c46@sha256:575b6f371770a1b5a3d8de7dee3e8da884a708ee20f07fee8a761b3173f2c886; kore-hostname-ownership=0.0.0-27e7f1b7989c@sha256:2e385470530dea876cc811570ddb31e3146995b797707fd86c000f7d5c689973; kore-local-tls=0.0.0-d7527b54a884@sha256:821e45a1c7d82a08be236d03880f05d43544f00952eda2e6cc4d8cbbbcc1865b; kore-platform-config=0.0.0-beaff41bca0e@sha256:ba3282faf8cc3f325270f5a75ce7225a41318cf67a39d0825133e1f0203ec560
- Evidence: https://github.com/corekraft/kore/issues/1880#issuecomment-7121872592
- Recorded: 2026-11-24

On v0.26.0 with the release locks and the flag on in a throwaway overlay copy, a fresh kore local up from a purged cluster converged with exit 0: 9 Argo CD Applications Synced and Healthy, no pod outside Running or Completed. Load 4.7 at start, 12 GB available.
