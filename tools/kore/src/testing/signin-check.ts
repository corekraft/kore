import { randomBytes } from "node:crypto";
import {
  backstageHostname,
  gatewayEntryPort,
  keycloakHostname,
  type Repository,
} from "../config/index.js";
import { pinnedBrowserImage, runHeadlessBrowser } from "./headless-browser.js";
import type { Runner } from "../runtime/index.js";
import { defaultRealm, KeycloakTestUsers } from "./keycloak-test-user.js";
import {
  backstageSignInPaths,
  signInProgram,
  type SignInPaths,
} from "./signin-program.js";

// Docs: docs/decisions/0111-run-a-backstage-and-an-argo-cd-for-the-platform-organization-s-operators.md
// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md
// Docs: docs/decisions/0034-registry-authentication-and-authorization.md (stream-only Secrets)

export interface SignInAssertion {
  name: string;
  ok: boolean;
  [detail: string]: unknown;
}

export interface SignInResult {
  passed: boolean;
  assertions: SignInAssertion[];
}

function assertionsOf(reply: unknown): SignInAssertion[] {
  const assertions = (reply as { assertions?: unknown }).assertions;
  if (!Array.isArray(assertions)) {
    throw new Error(
      "the sign-in check printed a result with no assertions list",
    );
  }
  return assertions as SignInAssertion[];
}

/**
 * Where the check signs in: the HTTPS host the sign-in lands on, the Keycloak
 * realm the throwaway user is created in, and the paths the browser uses.
 */
export interface SignInTarget {
  host: string;
  realm: string;
  paths: SignInPaths;
}

/** Backstage's target from the environment: its host, the platform realm, and Backstage's paths. */
export function backstageSignInTarget(repository: Repository): SignInTarget {
  return {
    host: backstageHostname(repository.environment),
    realm: defaultRealm,
    paths: backstageSignInPaths,
  };
}

/**
 * Signs in through the platform Keycloak as a throwaway operator and checks the
 * two assertions of the sign-in check, on the target (Backstage when none is
 * given). The user is created for this run, added to platform-operators, and
 * removed whether the check passes or fails. The password is generated in
 * memory, streamed to the browser on stdin, and never returned or printed.
 */
export async function checkSignIn(
  repository: Repository,
  runner: Runner,
  target: SignInTarget = backstageSignInTarget(repository),
): Promise<SignInResult> {
  const password = randomBytes(24).toString("base64url");
  const username = `kore-signin-check-${randomBytes(4).toString("hex")}`;
  const users = await KeycloakTestUsers.connect(
    repository,
    runner,
    target.realm,
  );
  const id = await users.create(username, password);
  let outcome: SignInResult;
  try {
    await users.addToOperators(id);
    const reply = await runHeadlessBrowser(runner, {
      image: pinnedBrowserImage,
      program: signInProgram({
        host: target.host,
        keycloakHost: keycloakHostname(repository.environment),
        port: gatewayEntryPort,
        username,
        password,
        paths: target.paths,
      }),
      secrets: [password],
    });
    const assertions = assertionsOf(reply);
    outcome = { passed: assertions.every((a) => a.ok), assertions };
  } catch (error) {
    await removeOrReport(users, id, username, error);
    throw error;
  }
  await users.remove(id);
  return outcome;
}

/** Removes the user after a failed run. A removal that also fails is reported beside the original error. */
async function removeOrReport(
  users: KeycloakTestUsers,
  id: string,
  username: string,
  original: unknown,
): Promise<void> {
  try {
    await users.remove(id);
  } catch (removal) {
    const reason =
      original instanceof Error ? original.message : String(original);
    const cause = removal instanceof Error ? removal.message : String(removal);
    throw new Error(
      `${reason}; the test user ${username} (${id}) was also not removed: ${cause}`,
    );
  }
}
