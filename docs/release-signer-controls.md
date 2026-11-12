# Release Signer Controls

What binds the accepted Cosign authority to one protected automation identity
([ADR 0028](decisions/0028-image-trust-authority.md),
[ADR 0044](decisions/0044-managed-platform-images-from-the-mirror.md)), what the repository checks
itself, and what only GitHub settings can enforce. No decision changes here; this
is the checklist for the part the repository cannot configure.

## Enforced in the repository

- **One signing identity.** `managed-example` trusts only
  `https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/vX.Y.Z`
  from the GitHub Actions issuer. Validation (`kore validate`) rejects regexps,
  wildcards, `refs/heads/`, `refs/pull/`, other workflows, and other
  repositories, and a test ties the committed subjects to the workflow's real
  `IDENTITY`
  (`tools/kore/src/config/image-trust.spec.ts`).
- **Token permissions.** `node skills/bin/harness.mjs hook workflow-permissions` (run by
  `mise run test-hooks`, so by the `check` workflow) fails when:
  - a workflow other than `release.yaml`, or a job other than `release` and
    `mirror`, requests `id-token: write` or `packages: write`;
  - any non-release workflow requests any write scope;
  - `release.yaml` can run on `pull_request` or `pull_request_target`, or a
    signing job lacks `if: github.ref_type == 'tag'`;
  - a workflow lacks read-only top-level `permissions`, or a job lacks explicit
    `permissions`.
- Cluster workloads, developers' machines, and registry administrators hold no
  signing key: keyless signing needs a GitHub OIDC token only a workflow run
  can mint, and the local key `local-kore-key` is not a managed authority.

## Manual: GitHub settings

The repository cannot configure these, and Kore does not change them. Without
them anyone able to push a `v*` tag, or to run a workflow with a write token,
can obtain a trusted signature. Verify with read-only `gh api` calls (needs
admin read access); each should print what the comment says.

1. **Tag ruleset for `v*`** — target `tag`, include `refs/tags/v*`,
   enforcement `active`, rules `creation`, `update`, `deletion` (and
   `non_fast_forward`). Bypass only for the maintainers and the
   `github-actions` integration, which release-please's dispatch needs.

   ```sh
   gh api repos/corekraft/kore/rulesets \
     --jq '.[] | {id, name, target, enforcement}'
   gh api repos/corekraft/kore/rulesets/<id> \
     --jq '{target, enforcement, include: .conditions.ref_name.include,
            rules: [.rules[].type], bypass: .bypass_actors}'
   ```

2. **Default workflow token is read-only.**

   ```sh
   gh api repos/corekraft/kore/actions/permissions/workflow
   # default_workflow_permissions: "read"
   ```

3. **Fork pull requests need approval and get no secrets.**

   ```sh
   gh api repos/corekraft/kore/actions/permissions/fork-pr-contributor-approval
   # approval_policy: not "first_time_contributors_new_to_github" or looser
   gh api repos/corekraft/kore/actions/permissions
   # allowed_actions: "selected" or "local_only"; sha_pinning_required: true
   ```

4. **Who may push tags, change workflows, or bypass the ruleset.** Only
   maintainers should hold write or higher, and `main` should need a reviewed
   pull request (`release.yaml` on `main` is the file that mints the identity).

   ```sh
   gh api repos/corekraft/kore/collaborators \
     --jq '.[] | {login, role: .role_name}'
   gh api repos/corekraft/kore/rulesets \
     --jq '.[] | select(.target == "branch") | {name, enforcement}'
   ```

   The `main` ruleset (id `26788821`, target `~DEFAULT_BRANCH`, enforcement
   `active`) holds four rules: `deletion`, `non_fast_forward`, a squash-only
   `pull_request` rule, and `required_status_checks` for `check` and `scan`
   from the GitHub Actions app (id `15368`), non-strict. The checks are
   required so the judge and merge tool cannot merge a change whose CI or
   scans have not passed; non-strict means a branch need not be up to date,
   which avoids a re-run per merge. The repository owner bypasses it. A legacy
   branch-protection rule on `main` also requires `check`; it is redundant and
   `scan` is enforced only by the ruleset.

   ```sh
   gh api repos/corekraft/kore/rulesets/26788821 \
     --jq '{enforcement, rules: [.rules[] | {type, checks: .parameters.required_status_checks}]}'
   ```

5. **Environment protection (not relied on today).** The signing jobs declare no
   `environment:`, so there is nothing to protect yet; the check below should
   list none, or only environments with required reviewers and a `v*` tag
   deployment policy if one is added later. Adding one does not change the
   certificate identity (it is the `job_workflow_ref`).

   ```sh
   gh api repos/corekraft/kore/environments \
     --jq '.environments[]? | {name, rules: [.protection_rules[].type]}'
   ```

6. **GHCR package write access.** Each package under
   `ghcr.io/corekraft/kore/` should grant write only to this repository's
   Actions and to maintainers. GitHub exposes no read API for package access
   settings; check each package's _Manage Actions access_ and _Manage access_
   pages by hand.

## Still open

- Replace `local-kore-key` as the cluster's signer with the release identity in
  a live run; roll workloads to the signed digests (plan Step 7).
- A KMS/HSM key remains an option if keyless is ever unsuitable; none is
  configured.
