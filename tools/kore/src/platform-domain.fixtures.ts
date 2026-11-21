// The platform domain the unit and integration fixtures default to. It mirrors
// platform.domain in infra/environments/local/environment.yaml, which the
// environment owns. Unit tests cannot read that file, so the integration spec
// local-platform-names.spec.ts fails when the two differ. A unit test injects
// another domain instead of editing a fixture.

/** The default platform domain for the fixtures: the local environment's domain. */
export const defaultPlatformDomain = "kore.internal";

/**
 * The registry host the committed release lock names (infra/catalog/images.lock.json).
 * The lock changes only through a release, so the platform domain's move to
 * kore.internal leaves it here: a lock reference does not follow platform.domain
 * (ADR 0132's refinement, see the registry section there).
 */
export const lockRegistryHost = "registry.kore.local:30500";
