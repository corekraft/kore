---
name: pin-upgrade
description: Use when upgrading or adding a pinned tool, chart, controller, or provider version.
---

# Pin or upgrade a version

Everything is pinned to an exact version (`AGENTS.md`: pin everything). An upgrade is deliberate and recorded with its compatibility evidence.

## Checklist

1. **Find every pin.** Tools are pinned in `.mise.toml` and mirrored in `infra/catalog/versions.yaml`; controllers and charts in `versions.yaml`, `infra/catalog/components.yaml`, and `infra/charts/`. Search for the old version string and change every occurrence together.
2. **Use exact versions.** No ranges, no `latest`.
3. **Check compatibility.** Read the upstream release notes (for example `gh release view <tag> --repo <owner>/<repo>`) against the contract column in `infra/catalog/compatibility.md`. Ask: what does this release break or deprecate that we rely on? Does any CRD change its owner?
4. **Verify offline.** Run `mise run validate`, `mise run test`, and `mise run test-opa`. A controller upgrade must also render offline and pass CRD ownership tests.
5. **Record the evidence.** Update `infra/catalog/compatibility.md` with the new version, the date, and the contract it satisfies. Note that the live bootstrap test is still required before a release is tagged.
