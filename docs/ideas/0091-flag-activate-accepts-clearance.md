---
summary: Implements ADR 0184: flag activate turns a flag on in any non-local environment from a recorded release gate clearance of local proof, and AGENTS.md's It just works rule is rewritten with it.
hypothesis: Accepting one recorded clearance of local proof for every non-local environment removes repeated per-environment live runs for an unchanged feature.
expected-outcome: A flag cleared once from local proof turns on in staging and production with no further live run, and flag audit accepts the clearance as its proof.
measurement: Count activations by proof kind and live runs per activated flag in the ledger, before and for 14 days after.
safety-pattern: feature-flagged
date: 2026-11-24
issue: https://github.com/corekraft/kore/issues/2022
---

# Idea 0091: flag activate accepts a release gate clearance
