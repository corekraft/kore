import {
  gatewayEntryPort,
  keycloakHostname,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { backstageDeliveryProgram } from "./backstage-delivery-program.js";
import { pinnedBrowserImage, runHeadlessBrowser } from "./headless-browser.js";
import {
  assertionsOf,
  backstageSignInTarget,
  withSignInTestUser,
  type SignInResult,
} from "./signin-check.js";

// Docs: infra/plans/15-next-horizon.md (Step 6, the delivered services in Backstage)
// Docs: docs/decisions/0180-backstage-reads-the-argo-cd-view-as-its-own-service-account-gated-by-the-operators-policy.md

const DNS_LABEL = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

/**
 * The Backstage delivery check on one delivered Service (#1881). It signs in as a
 * throwaway operators-group user and asserts that the signed-in operator's
 * Backstage identity carries the operators group, that the catalog lists the
 * Service, and that Backstage's Kubernetes view returns the Service's Argo CD
 * Application with its sync and health and its workload with its rollout. The
 * user is removed on success and on failure. A name that is not one DNS label is
 * refused before a user is created.
 */
export async function checkBackstageDelivery(
  repository: Repository,
  runner: Runner,
  service: string,
): Promise<SignInResult> {
  if (!DNS_LABEL.test(service)) {
    throw new Error(
      `the Backstage delivery check takes a delivered Service's name, one DNS label such as golden-path-example; got "${service}"`,
    );
  }
  const target = backstageSignInTarget(repository);
  return withSignInTestUser(
    repository,
    runner,
    target.realm,
    async (username, password) => {
      const reply = await runHeadlessBrowser(runner, {
        image: pinnedBrowserImage,
        program: backstageDeliveryProgram({
          host: target.host,
          keycloakHost: keycloakHostname(repository.environment),
          port: gatewayEntryPort,
          username,
          password,
          service,
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
