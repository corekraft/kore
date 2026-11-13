# Tool tests

Unit tests live beside the TypeScript modules and run without a cluster. Tests
that require a k3d cluster are intentionally opt-in (`npm run test:live`) and
must set `KORE_RUN_LIVE=1`; ordinary CI never creates or destroys a local
profile.
