---
status: accepted
summary: A namespace that git delivers is enrolled in Sigstore admission by the component that creates it, behind golden-path-template-admission, and kore app up still enrols application namespaces.
date: 2026-11-23
last-verified: 2026-11-23
---

# ADR 0181: Namespaces delivered from git are enrolled in image admission by their creator

Source: [`infra/plans/15-next-horizon.md` § Step 4](../../infra/plans/15-next-horizon.md#step-4-golden-path-templates)

Refines: [ADR 0032](0032-application-namespace-image-admission.md) (its "`kore app up` enrolls every application namespace" holds for the namespaces `kore app up` creates; this ADR covers the namespaces git delivers), and [ADR 0028](0028-image-trust-authority.md) (no namespace is opted in there).

## Context

ADR 0032 enrols an application namespace in Sigstore admission in one place:
`kore app up` labels the namespace it applies, and reads the label back. The
golden-path namespaces (`<service>--<environment>`) are created by something
else. The golden-path ApplicationSet creates them through Argo CD's
`CreateNamespace`, and once the Service records are on the Service composition
creates them. Neither goes through `kore app up`, so the template images that
run in them are never admitted under `kore-template-images` (plan 15 step 4).
The image-trust guard that held the line until now allowed no namespace opt-in
at all, which blocked the live proof of admission by digest.

## Decision

- **The creator enrols the namespace it creates.** A namespace that git delivers
  carries `policy.sigstore.dev/include: "true"` from the component that creates
  it, and no other component adds or removes that label. For the golden-path
  namespaces those components are the golden-path ApplicationSet, through
  `managedNamespaceMetadata`, and the Service composition, through its namespace
  labels. A namespace the creator does not create is not enrolled by git.
- **The label is behind `golden-path-template-admission`.** Each creator adds the
  label only while that flag is on. With the flag off, the rendered output carries
  no enrolment label, so the flag off changes nothing.
- **`kore app up` still enrols application namespaces.** Its mandatory enrolment
  (ADR 0032) is unchanged. It creates the application namespace from the CLI, not
  from git, so it stays the enroller of those namespaces.
- **The label is confined to the two creators.** The repository carries the
  enrolment label in those two creator templates and nowhere else in the charts
  or environment overlays. Any other chart or overlay that carries it fails the
  image-trust guard.
- **Local stays unenrolled, and the flag stays off in every overlay** until a
  recorded live outcome turns it on (`harness flag activate`).

## Consequences

- Enrolment of the golden-path namespaces is a git change behind a flag, so it is
  reviewed like any chart change, and it is removed by turning the flag off.
- The enrolment rule for a git-delivered namespace is the creator's, so a future
  chart that creates a namespace and must be enrolled labels it there, behind its
  own flag, and is added to the guard's allowed list in the same change.
- The namespace's own label is the only enrolment mechanism for git-delivered
  namespaces, so the readiness check for the template policy (which waits on the
  policy, not the label) does not prove enrolment; the live proof does.
