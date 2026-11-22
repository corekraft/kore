import {
  gatewayEntryPort,
  keycloakHostname,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { pinnedBrowserImage, runHeadlessBrowser } from "./headless-browser.js";
import {
  assertionsOf,
  withSignInTestUser,
  type SignInResult,
  type SignInTarget,
} from "./signin-check.js";
import { signInTokenProgram } from "./signin-token-program.js";

// Docs: infra/plans/15-next-horizon.md (Step 7, the browser token test)
// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md

/**
 * The browser token test (#1116) on one golden-path Service. It signs in through
 * Keycloak as a throwaway operators-group user and checks, after the sign-in, that
 * no access or refresh token is readable by script, in a response body or a URL,
 * and that every session cookie the Service sets is host-only, HttpOnly, Secure
 * and SameSite. The user is removed on success and on failure. The target must
 * carry its own sign-in paths, which Backstage's do not, so it is refused first.
 */
export async function checkSessionTokens(
  repository: Repository,
  runner: Runner,
  target: SignInTarget,
): Promise<SignInResult> {
  const { paths } = target;
  if (paths === undefined) {
    throw new Error(
      `the token check needs the target's own sign-in paths, such as a golden-path Service's; ${target.host} has none`,
    );
  }
  return withSignInTestUser(
    repository,
    runner,
    target.realm,
    async (username, password) => {
      const reply = await runHeadlessBrowser(runner, {
        image: pinnedBrowserImage,
        program: signInTokenProgram({
          host: target.host,
          keycloakHost: keycloakHostname(repository.environment),
          port: gatewayEntryPort,
          username,
          password,
          paths,
        }),
        secrets: [password],
      });
      const assertions = assertionsOf(reply);
      return {
        passed: assertions.every((assertion) => assertion.ok),
        assertions,
      };
    },
  );
}
