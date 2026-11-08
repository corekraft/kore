---
status: accepted
summary: Organizations nest at most four levels below the tenant root, services may sit at any level, and namespaces carry only tenant and organization labels while the controller resolves ancestry from the model.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0038: Cap organization depth at four and label namespaces by tenant and organization

Source: [`docs/vision.md` § Tenancy Model](../vision.md#tenancy-model)

## Context

Organizations nest: a tenant root holds sub-organizations, such as the companies
under an umbrella, and they may hold their own. Unbounded depth makes policy
inheritance and the portal tree hard to reason about, and a fixed three-level
shape cannot represent a company inside a company. Encoding the full path in a
namespace label would also hit the 63-character limit on label values.

## Decision

- **At most four levels below the tenant root.** The `Organization` API
  rejects a parent that would make an organization deeper than that.
- **Services may belong to an organization at any level,** including the
  tenant root.
- **Two labels, not a path.** Each service namespace carries
  `platform.kore.dev/tenant` and `platform.kore.dev/organization`, whose values
  are the stable identifiers of the tenant root and the owning organization.
- **Ancestry comes from the model.** The controller resolves an organization's
  ancestors from the `Organization` resources and writes the inherited quotas,
  policy, and access it implies. Nothing parses ancestry from labels.

## Consequences

- Organization identifiers must be valid label values: DNS-label safe and at
  most 63 characters.
- Moving an organization relabels only its own namespaces' organization label;
  the tenant label changes only when it moves to another tenant, which is an
  operator action.
- Raising the depth limit later is a schema change recorded in a new ADR.
