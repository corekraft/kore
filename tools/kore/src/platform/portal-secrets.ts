import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { ensureBackstageOidc } from "./backstage-oidc.js";
import { ensureKeycloakAdmin } from "./keycloak-admin.js";

// Docs: docs/decisions/0034-registry-authentication-and-authorization.md (stream-only Secrets)

/**
 * Streams every Secret the platform portal needs before its components start
 * (platform-portal on): the Keycloak bootstrap admin, then Backstage's sign-in
 * secrets. Each is stream-only and never rotated once present.
 */
export async function ensurePortalSecrets(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  await ensureKeycloakAdmin(repository, runner);
  await ensureBackstageOidc(repository, runner);
}
