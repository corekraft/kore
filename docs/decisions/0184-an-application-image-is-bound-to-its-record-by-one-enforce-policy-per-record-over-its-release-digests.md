---
status: proposed
summary: While suborg-image-policy is on, each app record with a release gets its own enforce ClusterImagePolicy over its release digests, with the platform workflow identity as the one keyless authority and a Rego policy that admits a signature only when the GitHub repository its workflow ran in is the record's repository.
date: 2026-11-25
last-verified: 2026-11-25
---

# ADR 0184: an application image is bound to its record by one enforce policy per record over its release digests

Source: [`infra/plans/2-implementation.md` § Step 9](../../infra/plans/2-implementation.md#step-9-workload-identity-application-image-trust-and-policy)

Refines: [ADR 0165](0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md) (one separate ClusterImagePolicy for application images) and [ADR 0166](0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md) (admission binds an image to its record through the signature's source repository).

## Context

ADR 0165 asks for one separate ClusterImagePolicy for application images, in `enforce`, with the platform workflow identity as its one keyless authority. ADR 0166 adds that the signature's source repository must equal the record's `repository`. Issue 1556 asked whether the pinned Policy Controller, v0.13.1 (built on cosign v2.5.0), can express that. The answer comes from upstream source at those versions:

- **Policies can't select a namespace.** A ClusterImagePolicy selects images by glob only. The include label decides which namespaces are evaluated at all.
- **The policy can't tell which image it is judging.** The input of a policy-level `rego` or `cue` policy is the `PolicyResult`: the verified signatures of each authority, optionally with the resource's spec and metadata. It doesn't include the image reference, so one policy can't map an image to a record by itself.
- **The policy sees the workflow repository, not the source-repository extension.** Each signature carries its subject and issuer, plus the GitHub extensions Fulcio OIDs 1.3.6.1.4.1.57264.1.2 to .6. OID .5, `githubWorkflowRepo`, is the `owner/name` of the repository the workflow ran in. For a reusable workflow, that is the calling application's repository. The newer source-repository extension, OID .12, isn't passed to the policy.
- **Records carry digests, not image repositories.** A record has no image repository yet ([issue 1575](https://github.com/corekraft/kore/issues/1575)), so what ties an image to its record is the release's digests.

## Decision

While `suborg-image-policy` is on (it needs `suborg-tenancy`):

- **One policy per record, not one for all records.** Every app record whose release carries a digest gets its own ClusterImagePolicy, `kore-app-<service>`, rendered by the image-policy chart from the records kore passes it. Its globs are the record's release digests, `**@sha256:<digest>`, so they match whichever repository serves the image.
- **Enforce, with exactly one keyless authority.** Each record's policy runs in `enforce` whatever `trust.mode` says. Its one authority, `platform-workflow`, uses the issuer and exact subjects of the environment's `trust`, the identity platform images are already verified against. There is no regexp, static pass or key. `kore-platform-images` keeps its own policy and `trust.mode`.
- **The binding is a Rego policy.** It admits the image when at least one signature has the trusted issuer and subject, and `github.com/<githubWorkflowRepo>` equals the record's `repository`. It checks issuer and subject again, even though the authority already did, so the rendered rules refuse another identity on their own and an offline test can show it. With no record rendered, it refuses everything. The rules live in `infra/charts/image-policy/policies/application-images.rego`, with an `opa test` spec beside them that runs in Rego v0 mode, the parser Policy Controller uses.
- **kore validate refuses before any cluster** a trust that isn't keyless, and a record with release digests whose `repository` is missing or isn't `github.com/<owner>/<name>`. Each message names the flag and the fix.

## Consequences

- An image an application signs itself, an image signed by another identity, and an image the platform workflow signed for another record's repository are all refused for a record's digests.
- **Gap: images outside every record.** An image no record's release names isn't matched by any application policy. It falls to the policies that match its glob (the platform registry in `warn`, the template repository, the upstream static pass) or to the no-match setting. Enforcing "platform-signed only" for every image in a suborg namespace needs application images in a repository of their own (issue 1575), which a glob can then cover.
- **The trusted subjects are still the release tags.** The authority trusts the platform's `release.yaml@refs/tags/vX.Y.Z` subjects. ADR 0170's reusable workflow, pinned by commit SHA, needs the subject widening that ADR describes before a real application image can pass.
- **local can't turn the flag on.** local uses key trust, and the policy has no keyless identity to reuse there.
- **To verify live** (#1559): that Fulcio still issues the deprecated OID .5 for GitHub Actions, and that it holds the caller's repository when the workflow is a reusable one.
- Record names must be unique across the cluster ([ADR 0166](0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md)), so each policy name is too. Two records that share a digest would both have to admit it.
