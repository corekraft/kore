import { platformPlan, type Environment } from "../config/index.js";
import type { SignInPaths } from "./signin-program.js";
import type { SignInTarget } from "./signin-check.js";

// Docs: docs/decisions/0042-organization-domains-by-delegation.md
// Docs: infra/plans/15-next-horizon.md (Step 7, the golden-path sign-in)

/**
 * The paths of a golden-path Service's sign-in: the Spring start that redirects
 * to Keycloak, and /api/whoami, which answers 200 for a signed-in session and
 * redirects or answers 401 with no sign-in (issue #1760).
 */
export const goldenPathSignInPaths: SignInPaths = {
  startPath: "/oauth2/authorization/golden-path",
  signedInCallPath: "/api/whoami",
  anonymousPath: "/api/whoami",
};

const dnsLabel = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The sign-in target of a delivered golden-path Service: its HTTPS host in the
 * platform organization's default zone, <service>.<organizationId>.<domain>
 * (ADR 0042), and the platform realm its Keycloak client is in. The name is
 * checked to be one DNS label before it reaches a host or a command.
 */
export function goldenPathSignInTarget(
  environment: Environment,
  service: string,
): SignInTarget {
  if (!dnsLabel.test(service)) {
    throw new Error(
      `KORE_SIGNIN_SERVICE must be one DNS label (lowercase letters, digits and hyphens, at most 63 characters, no dots), such as golden-path-example; got '${service}'`,
    );
  }
  const { domain, organizationId } = platformPlan(environment);
  return {
    host: `${service}.${organizationId}.${domain}`,
    realm: "platform",
    paths: goldenPathSignInPaths,
  };
}
