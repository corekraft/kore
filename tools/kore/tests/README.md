# Tool tests

Unit tests live beside the TypeScript modules and run without a cluster. Tests
that require Minikube are intentionally opt-in (`npm run test:integration`) and
must set `KORE_RUN_INTEGRATION=1`; ordinary CI never creates or destroys a local
profile.

