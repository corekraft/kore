// The platform domain the unit and integration fixtures default to. It mirrors
// platform.domain in infra/environments/local/environment.yaml, which the
// environment owns (ADR 0132: kore.internal, with kore.local as the deprecated
// alias). Unit tests cannot read that file, so the integration spec
// local-platform-names.spec.ts fails when the two differ. A unit test injects
// another domain instead of editing a fixture.

/** The default platform domain for the fixtures: the local environment's domain. */
export const defaultPlatformDomain = "kore.internal";

/**
 * The registry host the release lock pins its references under. The lock does
 * not follow the domain: its references are the identities the digests and
 * signatures were verified under, so a domain flip is a release, not a cutover
 * (ADR 0132, the registry reference decision).
 */
export const lockedRegistryHost = "registry.kore.local";
