---
summary: Kore-published host ports bound off loopback stay at zero
hypothesis: With every Kore-published host port bound to 127.0.0.1, a fresh local profile has zero published host ports listening off loopback.
expected-outcome: Zero Kore-published host ports bound off loopback on a fresh local profile (docker ps shows only 127.0.0.1 bindings).
measurement: Count of host ports published by the local cluster whose bind address is not 127.0.0.1, read from docker ps on a fresh profile. First reading on #1197: Gateway 8443 is loopback; the API port 59290 is still on all interfaces, tracked in #1320.
safety-pattern: no-behaviour-change
date: 2026-11-19
issue: https://github.com/corekraft/kore/issues/1321
outcome: confirmed
---

# Idea 0048: Kore-published host ports bound off loopback stay at zero

## Outcome

- Result: confirmed
- Kind: experiment
- Source: live-run
- Evidence: kore-agents, profile created by kore local up at 2026-11-20T12:50Z, read 16:30Z: docker ps / docker inspect show 127.0.0.1:8443->30443 and 127.0.0.1:40535->6443, 80/tcp unpublished; ss -ltn shows both listeners on 127.0.0.1; 0 host ports off loopback
- Recorded: 2026-11-20

Zero Kore-published host ports bound off loopback on a fresh kore-agents profile: 8443 and the API port 40535 are both 127.0.0.1.
