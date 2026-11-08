---
status: accepted
summary: Portability validation renders application charts with chart-default values only and rejects provider output; rendered platform manifests written to disk have Secret values and sensitive keys redacted with the journal's marker.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0021: Render for portability and redact rendered output

Source: [`infra/plans/2-implementation.md` § Progress Record](../../infra/plans/2-implementation.md#progress-record)
(Steps 8 and 14)

Refines: [ADR 0012](0012-environment-overlays-hold-provider-specifics.md)

## Context

Portability validation only scanned chart files, so a template could emit
provider-specific output without being caught. Separately, `kore platform render
--output` wrote rendered manifests to disk with any Secret values intact.

## Decision

- `validatePortability` runs `helm template` through the injected runner for
  each `apps/*/charts/*` chart with no `--values`, so no environment overlay can
  mask a provider dependency, and fails on a render error or provider-specific
  rendered output. `mise run validate` (and CI) validates both `local` and
  `managed-example`.
- `redactManifest` replaces Secret `data`/`stringData` values and values under
  sensitive keys with the journal's `<redacted>` marker, reusing the journal's
  sensitive-name rule. Secret references (`secretName`, `*Ref`, `*Store`, bare
  `key`) stay readable. Only the on-disk copy is redacted; kubectl still
  receives the real manifest over stdin, because client dry-run needs valid
  Secret data and its output is not printed.
- A root `.prettierrc.json` sets `trailingComma: none` for `infra/**` and
  `apps/**` YAML, and a test fails if formatting the catalogs yields non-JSON.

## Consequences

Rendered files are safe to share but not applyable as-is. CI needs `helm`.
