import { serviceHostname, type Environment } from "../config/index.js";

// Docs: docs/decisions/0042-organization-domains-by-delegation.md
// Docs: infra/plans/15-next-horizon.md (Step 7, the golden-path sign-in)

/** The paths a sign-in takes on a target, as the sign-in check reads them. */
export interface GoldenPathSignInPaths {
  startPath: string;
  signedInCallPath: string;
  anonymousPath: string;
}

/** A target the sign-in check signs in to: its host, the realm, and its paths. */
export interface GoldenPathSignInTarget {
  host: string;
  realm: string;
  paths: GoldenPathSignInPaths;
}

/**
 * The paths of a golden-path Service's sign-in: the Spring start that redirects
 * to Keycloak, and /api/whoami, which answers 200 for a signed-in session and
 * redirects or answers 401 with no sign-in (issue #1760).
 */
export const goldenPathSignInPaths: GoldenPathSignInPaths = {
  startPath: "/oauth2/authorization/golden-path",
  signedInCallPath: "/api/whoami",
  anonymousPath: "/api/whoami",
};

const dnsLabel = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The sign-in target of a delivered golden-path Service: its HTTPS host in the
 * platform organization's zone, and the platform realm its Keycloak client is in.
 * The name is checked to be one DNS label before it reaches a host or a command.
 */
export function goldenPathSignInTarget(
  environment: Environment,
  service: string,
): GoldenPathSignInTarget {
  if (!dnsLabel.test(service)) {
    throw new Error(
      `KORE_SIGNIN_SERVICE must be one DNS label (lowercase letters, digits and hyphens, at most 63 characters, no dots), such as golden-path-example; got '${service}'`,
    );
  }
  return {
    host: serviceHostname(environment, service),
    realm: "platform",
    paths: goldenPathSignInPaths,
  };
}
