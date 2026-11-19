// The platform domain the unit and integration fixtures default to. It mirrors
// platform.domain in infra/environments/local/environment.yaml, which the
// environment owns. Unit tests cannot read that file, so the integration spec
// local-platform-names.spec.ts fails when the two differ. A unit test injects
// another domain instead of editing a fixture.

/** The default platform domain for the fixtures: the local environment's domain. */
export const defaultPlatformDomain = "kore.local";
