---
summary: Implements ADR 0183 behind factory-merge: a head the principles review permits merges once required checks are green and the head is unchanged, with no judge pane.
hypothesis: Merging deterministically on the principles review verdict, green required checks and an unchanged head removes the judge pane's wait without merging an unprotected change.
expected-outcome: Each permitted head merges within one tick of its checks turning green, no merge lands on a head other than the one reviewed, and no rejected head merges.
measurement: Compare each merge's head with its review verdict's head and time the merge after green in the ledger, for 14 days after factory-merge turns on in local.
safety-pattern: feature-flagged
date: 2026-11-24
issue: https://github.com/corekraft/kore/issues/2021
---

# Idea 0090: The merge tool merges on the principles review verdict
