---
status: proposed
summary: The bought platform domain never enters the public repository; one run-time variable overrides the vps overlay's placeholder inside platformPlan, the host's public and tailnet addresses and the zone id are run-time values too, a mutation refuses while the placeholder is in force and a flag that needs the real domain is on, and a leak guard starts in audit mode.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR XXXX: The platform domain is a run-time value and the repository holds a placeholder

Source: [#1483](https://github.com/corekraft/kore/issues/1483), decision 10 of the owner interview record [#1478](https://github.com/corekraft/kore/issues/1478), and the answerer's reasoning on #1483 (2026-11-20)

Refines: [ADR 0042](0042-organization-domains-by-delegation.md) (the platform domain is one per-environment field), [ADR 0142](0142-the-vps-environment-targets-the-persistent-k3s-node-as-a-managed-cluster.md) (the vps overlay's `kore.internal`)

## Context

Record 10 makes DNS and the registrar Cloudflare, and the repository is public.
The repository rule is that no tracked file names the bought domain: it is
written `example.com`, here and everywhere on GitHub. ADR 0042 and ADR 0132 hold
the platform domain as one environment field, `platform.domain`, which
`platformPlan()` reads and which kore hands to every chart as a Helm parameter.
ADR 0142 fills that field in the vps overlay with `kore.internal` because no
domain was bought.

The domain is not a secret: public DNS, certificate transparency and the public
hostnames reveal it. The rule is hygiene, so the repository stays
domain-agnostic. The alert address already works this way: plan 15 supplies
`KORE_ALERT_EMAIL_ADDRESSES` only at run time, and `alert-email.ts` lets the
variable override the overlay field and names both in its error.

## Decision

- **A run-time override, read in one place.** The variable
  `KORE_PLATFORM_DOMAIN` overrides `platform.domain` for the vps environment, and
  only `platformPlan()` reads it, so every derived copy (the platform DNS zone,
  the wildcard, the Gateway listeners, the delivered Application parameters)
  follows it. The overlay keeps the placeholder `kore.internal` for good.
  `kore validate`, CI and every spec run without a real domain.
- **Other public facts are run-time values the same way.** The host's public
  IPv4 address, the Cloudflare zone id (an OpenTofu output after the zone is
  imported) and the host's tailnet address (which ADR 0142 already keeps out of
  the repository) are environment variables, in one owner-only, untracked file on
  each machine that runs kore: the Mac that records outcomes and kore-agents
  that runs proofs. OpenTofu reads them as `TF_VAR_*`. They are public facts, so
  they are not in sops; sops holds only the tokens.
- **Fail closed on the placeholder.** A mutating command that finds the
  placeholder in force while `external-dns` or `acme-dns01` is on refuses before
  touching the cluster and names the variable and the missing value. With the
  variable unset a vps run can render only internal names, so nothing public is
  published by accident.
- **Visible without printing.** `kore doctor`, read-only and with `--json`,
  reports the domain as placeholder or set and never prints the value when set. It
  reports the run-time values missing for the flags that are on and whether the
  two token Secrets exist; a missing one is a warning that names the fix.
- **Claims name labels, not the domain.** A hostname claim under the platform
  domain is written as a label relative to it (`login` means `login.<domain>`).
  A full hostname is allowed only for a foreign domain. Concept 4 owns the claim
  field; this is the rule it follows.
- **A leak guard, audit first.** A new harness guardrail, in audit mode
  ([ADR 0080](0080-guardrails-change-freely-activate-with-approval.md)), warns
  when a Write, an Edit, a commit message or a `gh` body contains the value of
  `KORE_PLATFORM_DOMAIN`, and only on a machine where it is set. Outcomes and
  ledger events are written with `example.com`. The guard is a work item and a
  guardrail request, not part of this decision.

## Consequences

- ADR 0142's statement that no real domain belongs in the overlay stays true;
  its description of `kore.internal` as the vps domain is revised to
  "the repository default".
- A domain bought later replaces nothing in git. A rebuilt controller needs the
  run-time file, and the domain is recoverable from the Cloudflare account.
- A foreign hostname in a public app record names a domain the owner holds
  elsewhere. That is the app's own public name, which the ACME proof makes public
  anyway, but it is the one place a real name can enter the repository.
- Argo CD renders Applications from parameters kore passes at install, so the
  domain reaches the cluster without being in git. A domain change is a platform
  rollout run, not a git commit.

## Decided by the owner

On 2026-11-20 the owner accepted every recommendation:

- A full foreign hostname may appear in a public app record.
- The owner buys the domain and tells the main session only that it exists; the
  name never appears on GitHub.
