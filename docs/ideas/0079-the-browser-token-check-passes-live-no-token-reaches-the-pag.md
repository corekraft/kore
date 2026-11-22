---
summary: The browser token check passes live: no token reaches the page and the session cookie is locked down
hypothesis: After a golden-path sign-in, no token is readable by script or in a URL, and the session cookies are host-only, HttpOnly, Secure and SameSite
expected-outcome: npm run test:live:golden-path-token passes all seven assertions on a delivered Service with golden-path-signin on
measurement: live run recorded on corekraft/kore#1116
safety-pattern: no-behaviour-change
date: 2026-11-22
issue: 1116
outcome: confirmed
---

# Idea 0079: The browser token check passes live: no token reaches the page and the session cookie is locked down

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Evidence: https://github.com/corekraft/kore/issues/1116#issuecomment-7078678167
- Recorded: 2026-11-22

Runs on kore-agents, 2026-11-22, CLI 4012a8e8 against delivery-probe delivered from 78553ce9 with golden-path-signin on in a throwaway overlay. npm run test:live:golden-path-token passed all seven assertions: signed-in call 200; no token in localStorage, sessionStorage, non-HttpOnly cookies, response bodies or URLs; the one session cookie JSESSIONID is host-only, HttpOnly, Secure and SameSite=Lax. The first run failed only because the check read Set-Cookie from CDP headers, which Chromium omits; fixed in #1840. No flag change. The BFF runs as one pod while sign-in is on (#1837, #1841). The owner approved recording on 2026-11-22.
