import { randomBytes } from "node:crypto";
import type { Repository } from "../config/index.js";
import { withSecretsRedacted } from "../images/index.js";
import type { Runner } from "../runtime/index.js";

// Docs: docs/decisions/0034-registry-authentication-and-authorization.md (stream-only Secrets)
// Docs: docs/decisions/0111-run-a-backstage-and-an-argo-cd-for-the-platform-organization-s-operators.md

const namespace = "backstage";
const keycloakNamespace = "keycloak";
const secretName = "backstage-oidc";
const fieldManager = "kore-backstage-oidc";

const secret = (
  inNamespace: string,
  stringData: Record<string, string>,
): object => ({
  apiVersion: "v1",
  kind: "Secret",
  metadata: { name: secretName, namespace: inNamespace },
  type: "Opaque",
  stringData,
});

/**
 * Gives the platform Backstage its Keycloak sign-in: the OIDC client secret,
 * which Keycloak's `KeycloakOIDCClient` and the sign-in proxy must share (one
 * copy per namespace), and the proxy's cookie secret. Both are generated in
 * memory and reach the cluster only on kubectl's stdin, never to disk, an
 * argument or git. Existing Secrets are never rotated, so a registered client
 * and signed-in sessions stay valid. Returns whether Secrets were applied.
 */
export async function ensureBackstageOidc(
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
  // 192 random bits each; 24 bytes make a 32-character cookie secret.
  const clientSecret = randomBytes(24).toString("base64url");
  const cookieSecret = randomBytes(24).toString("base64url");
  await withSecretsRedacted([clientSecret, cookieSecret], async () => {
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
          kind: "List",
          items: [
            {
              apiVersion: "v1",
              kind: "Namespace",
              metadata: { name: namespace },
            },
            secret(namespace, {
              "client-secret": clientSecret,
              "cookie-secret": cookieSecret,
            }),
            secret(keycloakNamespace, { "client-secret": clientSecret }),
          ],
        }),
      },
    );
  });
  return true;
}
