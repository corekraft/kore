---
summary: drift-listing-mappings works live in local
hypothesis: kore local up refuses a running cluster that lacks a published mapping and passes a healthy one
expected-outcome: a real pre-cutover cluster is refused before any write and a healthy cluster is not refused
measurement: live run record on corekraft/kore#1683
safety-pattern: feature-flagged
date: 2026-11-24
issue: 1683
outcome: confirmed
---

# Idea 0082: drift-listing-mappings works live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: drift-listing-mappings
- Environment: local
- Lock: main
- Charts: opa-authorizer=0.0.0-e22e1a50faa7@sha256:f600ef2076d882d1cacb21591f28091908dd66404553dbf53147190e21e12f61; kore-postgresql-api=0.0.0-8e4902321c78@sha256:16a1519489d982341a62221ee060ec33c6a4dedfa28bf6774150120fb9d621bc; kore-policy-templates=0.0.0-b8f4944fd4f4@sha256:004a864043849aef1951fc17981388fc92902cfd736c1669423bba0e03de7135; kore-policy-constraints=0.0.0-707481e34bb1@sha256:c8f9737dd84a9abace5556be99d49b33cfbbb3bb26dc819a8f8910bc056be80e; kore-policy-sync=0.0.0-600b67d4a009@sha256:d77f71fb4a367f6c02bba61fa76e5b7a27af78a580fa1269c4b4b8a5026c2fde; kore-hostname-ownership-templates=0.0.0-505b861b5c46@sha256:575b6f371770a1b5a3d8de7dee3e8da884a708ee20f07fee8a761b3173f2c886; kore-hostname-ownership=0.0.0-27e7f1b7989c@sha256:2e385470530dea876cc811570ddb31e3146995b797707fd86c000f7d5c689973; kore-local-tls=0.0.0-d7527b54a884@sha256:821e45a1c7d82a08be236d03880f05d43544f00952eda2e6cc4d8cbbbcc1865b; kore-platform-config=0.0.0-34a5a0f77bfb@sha256:4d569f8fdf11642f198b4a9db6cced80f2feed8dbb02abd46a2c64d61ee00440
- Evidence: https://github.com/corekraft/kore/issues/1683#issuecomment-7120139080
- Recorded: 2026-11-24

On main 18f17a80 with the flag on in a throwaway overlay copy, kore local up refused a real pre-cutover cluster (no host 443) before any write, naming port 30443 platform-dns, and did not refuse a healthy cluster (fresh up converged, second up exit 0). Load 5.9 to 6.0 at the starts; the second run began at 20 while workloads settled.
