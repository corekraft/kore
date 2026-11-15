import type { Repository } from "../config/index.js";
import { withSecretsRedacted } from "../images/index.js";
import type { Runner } from "../runtime/index.js";

// Docs: docs/decisions/0034-registry-authentication-and-authorization.md (stream-only Secrets)
// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md

const namespace = "crossplane-system";
const secretName = "keycloak-provider-credentials";
const fieldManager = "kore-keycloak-provider-credentials";
const adminNamespace = "keycloak";
const adminSecret = "keycloak-admin";

async function kubectlGet(
  repository: Repository,
  runner: Runner,
  secretNamespace: string,
  name: string,
  output: string,
): Promise<string> {
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      secretNamespace,
      "get",
      "secret",
      name,
      "--ignore-not-found",
      `--output=${output}`,
    ],
    { capture: true },
  );
  return stdout.trim();
}

/**
 * Gives the Crossplane Keycloak provider the credential its ClusterProviderConfig
 * reads: the JSON the provider's Terraform backend expects, built in memory from
 * the platform Keycloak's bootstrap admin and streamed on kubectl's stdin, so
 * the password never reaches disk, an argument or git. An existing Secret is
 * never rewritten. Returns whether a Secret was applied.
 */
export async function ensureKeycloakProviderCredentials(
  repository: Repository,
  runner: Runner,
): Promise<boolean> {
  if (
    (await kubectlGet(repository, runner, namespace, secretName, "name")) !== ""
  ) {
    return false;
  }
  const encoded = await kubectlGet(
    repository,
    runner,
    adminNamespace,
    adminSecret,
    "jsonpath={.data.password}",
  );
  if (encoded === "") {
    throw new Error(
      `The ${adminSecret} Secret in ${adminNamespace} is missing, so the Keycloak provider has no credential. kore platform up streams it right after keycloak-operator installs; rerun it with platform-portal on.`,
    );
  }
  const password = Buffer.from(encoded, "base64").toString("utf8");
  await withSecretsRedacted([password], async () => {
    await runner.run(
      "kubectl",
      [
        "--context",
        repository.environment.kubeContext,
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
          type: "Opaque",
          stringData: {
            credentials: JSON.stringify({
              client_id: "admin-cli",
              username: "kore-admin",
              password,
              url: `http://keycloak-service.${adminNamespace}.svc:8080`,
              realm: "master",
            }),
          },
        }),
      },
    );
  });
  return true;
}
