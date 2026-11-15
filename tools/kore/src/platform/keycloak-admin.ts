import { randomBytes } from "node:crypto";
import type { Repository } from "../config/index.js";
import { withSecretsRedacted } from "../images/index.js";
import type { Runner } from "../runtime/index.js";

// Docs: docs/decisions/0034-registry-authentication-and-authorization.md (stream-only Secrets)
// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md

const namespace = "keycloak";
const secretName = "keycloak-admin";
const fieldManager = "kore-keycloak-admin";

/**
 * Gives the platform Keycloak its bootstrap admin, which the operator reads
 * from the `keycloak-admin` Secret on first start. The password is generated in
 * memory and reaches the cluster only on kubectl's stdin, never to disk, an
 * argument or git. An existing Secret is never rotated, so a running Keycloak
 * keeps the admin it started with. Returns whether a Secret was applied.
 */
export async function ensureKeycloakAdmin(
  repository: Repository,
  runner: Runner,
): Promise<boolean> {
  const context = repository.environment.kubeContext;
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      context,
      "--namespace",
      namespace,
      "get",
      "secret",
      secretName,
      "--ignore-not-found",
      "--output=name",
    ],
    { capture: true },
  );
  if (stdout.trim() !== "") {
    return false;
  }
  // 192 random bits, so a slow hash or a lockout policy adds nothing.
  const password = randomBytes(24).toString("base64url");
  await withSecretsRedacted([password], async () => {
    await runner.run(
      "kubectl",
      [
        "--context",
        context,
        "apply",
        "--server-side",
        `--field-manager=${fieldManager}`,
        "--force-conflicts",
        "--filename=-",
      ],
      {
        capture: true,
        input: JSON.stringify({
          apiVersion: "v1",
          kind: "Secret",
          metadata: { name: secretName, namespace },
          type: "kubernetes.io/basic-auth",
          stringData: { username: "kore-admin", password },
        }),
      },
    );
  });
  return true;
}
