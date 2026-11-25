---
status: proposed
summary: While suborg-secret-store is on, each suborg's ClusterSecretStore reads a per-suborg source namespace kore-suborg-<name> through the kubernetes provider, suborg names are capped at 51 characters, and OpenBao later swaps the provider behind the same store name.
date: 2026-11-25
last-verified: 2026-11-25
---

# ADR 0183: a suborg's secret store reads its own kore-suborg source namespace, and suborg names are capped at 51 characters while it is on

Source: [`infra/plans/2-implementation.md` § Step 8](../../infra/plans/2-implementation.md#step-8-networking-certificates-and-secrets)

Refines: [ADR 0167](0167-application-secrets-come-from-openbao-behind-the-platform-secrets-contract-one-path-per-suborg.md) (per-suborg isolation by OpenBao path). Builds on [ADR 0165](0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md) (the suborg namespace and its reserved names).

## Context

ADR 0167 isolates suborgs by OpenBao path: each suborg's store reads only its own path. OpenBao is not in the tree yet, so the interim `suborg-secret-store` flag (issue 1555) uses the External Secrets `kubernetes` provider instead. That provider reads Secrets from one namespace, so the interim form needs a namespace per suborg to keep the same isolation: a suborg's store must not read another suborg's source Secrets even by name. The provider choice is the only thing [#1595](https://github.com/corekraft/kore/issues/1595) changes later, so this ADR records what the interim form decides and why, so that OpenBao does not inherit a decision nobody wrote down.

## Decision

While `suborg-secret-store` is on, with `suborg-tenancy` on as well:

- **A source namespace per suborg, `kore-suborg-<name>`.** The Organization composition creates it (step `compose-suborg-secret-store`), labelled `platform.kore.dev/secret-source: "true"` and `istio.io/dataplane-mode: ambient`, so the mesh enrols it. The composition owns it, as it owns the suborg's own namespace under ADR 0165.
- **A store per suborg, named `suborg-<name>`.** It is a ClusterSecretStore limited by `conditions.namespaces` to the suborg's own namespace, with the `kubernetes` provider reading `remoteNamespace: kore-suborg-<name>`. Its CA comes from that namespace's `kube-root-ca.crt`, and its auth is the `external-secrets` ServiceAccount, as the shared `platform-secrets` store does. The shared store is neither changed nor rendered by this step.
- **The `kore-suborg-` prefix.** ADR 0165 reserves the `kore-` prefix for suborg names, so no suborg namespace can equal a source namespace, and the prefix names the source namespace's role at a glance. The store's `suborg-` prefix likewise means no suborg name can equal `platform-secrets`, so no suborg-names reservation is needed for the store.
- **A 51-character cap on suborg names while the flag is on.** A namespace name is at most 63 characters, and `kore-suborg-` is 12, so a suborg name is at most 51. `kore validate` refuses a longer name before any cluster, names both the length and the fix, and the refusal applies only while the flag is on. The cap is tighter than ADR 0165's 54 (for `<suborg>--preview`) by three characters; it binds only while the flag is on.
- **OpenBao swaps the provider later.** [#1595](https://github.com/corekraft/kore/issues/1595) changes the store's `provider` from `kubernetes` to OpenBao behind the same name, the same namespace condition, and the same suborg path rule of ADR 0167. The source namespace, its labels, the CA reference and the RBAC that lets the Crossplane service account manage the stores retire with the kubernetes provider, in the contract step after the soak. The cap exists only because of the source namespace, so it goes with it.
- **vps keeps the kubernetes provider.** The flag is false in every overlay, so vps stays on the default until its own live outcome. The OpenBao switch is #1595's and not this ADR's.

## Consequences

- Each suborg has two new objects behind one flag: its source namespace and its store. Both are composed by one step, so one owner exists for each.
- A suborg name longer than 51 characters cannot be used while the flag is on, and `kore validate` is the only place the cap is enforced. With the flag off the cap no longer applies and ADR 0165's rules hold alone.
- Sibling services in one suborg still share a namespace and so share its source Secrets, as ADR 0165 and ADR 0167 already state. The per-suborg source namespace isolates suborgs from each other, not services from siblings.
- The interim isolation is by namespace in the kubernetes provider and by path in OpenBao. This ADR does not claim the namespace form is as strong as the path form; it records that suborgs must not share a source namespace in either form.
