---
summary: A vps-limited flag audit warns on each true vps flag with no live-run outcome; its guardrail decides whether it fails
hypothesis: A vps-limited flag audit lists each true vps flag with no live-run outcome and its fix, and exits zero while its guardrail is in audit mode
expected-outcome: A fixture with a true vps flag and no outcome is listed with the fix and exits zero; a fixture where every true vps flag has a live-run outcome reports nothing
measurement: The vps fixtures in integration/flag-audit-vps.spec.ts, and harness flag audit --vps on this repository
safety-pattern: no-behaviour-change
date: 2026-11-25
issue: 1493
---

# Idea 0086: Warn on true vps flags with no live-run outcome, in audit mode
