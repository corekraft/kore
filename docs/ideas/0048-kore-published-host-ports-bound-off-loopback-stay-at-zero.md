---
summary: Kore-published host ports bound off loopback stay at zero
hypothesis: With every Kore-published host port bound to 127.0.0.1, a fresh local profile has zero published host ports listening off loopback.
expected-outcome: Zero Kore-published host ports bound off loopback on a fresh local profile (docker ps shows only 127.0.0.1 bindings).
measurement: Count of host ports published by the local cluster whose bind address is not 127.0.0.1, read from docker ps on a fresh profile. First reading on #1197: Gateway 8443 is loopback; the API port 59290 is still on all interfaces, tracked in #1320.
safety-pattern: no-behaviour-change
date: 2026-11-19
issue: https://github.com/corekraft/kore/issues/1321
---

# Idea 0048: Kore-published host ports bound off loopback stay at zero
