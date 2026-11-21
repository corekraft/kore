import { randomBytes } from "node:crypto";
import {
  gatewayEntryPort,
  platformPlan,
  type Repository,
} from "../config/index.js";
import { pinnedBrowserImage, runHeadlessBrowser } from "../browser/index.js";
import type { Runner } from "../runtime/index.js";
import { KeycloakTestUsers } from "./keycloak-test-user.js";
import { signInProgram } from "./signin-program.js";

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
 * Signs in to Backstage through the platform Keycloak as a throwaway operator
 * and checks the two assertions of the sign-in check. The user is created for
 * this run, added to platform-operators, and removed whether the check passes or
 * fails. The password is generated in memory, streamed to the browser on stdin,
 * and never returned or printed.
 */
export async function checkSignIn(
  repository: Repository,
  runner: Runner,
): Promise<SignInResult> {
  const { domain } = platformPlan(repository.environment);
  const password = randomBytes(24).toString("base64url");
  const username = `kore-signin-check-${randomBytes(4).toString("hex")}`;
  const users = await KeycloakTestUsers.connect(repository, runner);
  const id = await users.create(username, password);
  let outcome: SignInResult;
  try {
    await users.addToOperators(id);
    const reply = await runHeadlessBrowser(runner, {
      image: pinnedBrowserImage,
      program: signInProgram({
        domain,
        port: gatewayEntryPort,
        username,
        password,
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
