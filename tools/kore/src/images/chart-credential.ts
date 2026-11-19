import { chartRepositoryUrls, type Repository } from "../config/index.js";
import {
  koreManagesRegistryAuth,
  loadRegistryCredential,
  registryAddress,
  withSecretsRedacted,
} from "./registry-auth.js";
import type { Runner } from "../runtime/index.js";

// Docs: docs/decisions/0034-registry-authentication-and-authorization.md (stream-only Secrets)
// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (repository credentials)

const argocdNamespace = "argocd";
const fieldManager = "kore-chart-credential";

/**
 * Gives the platform Argo CD the registry's read identity for the chart
 * repositories kore itself serves, as an Argo CD repo credential template
 * (`repo-creds`) for each `oci://` registry path. A template matches every
 * chart under its path by prefix; a repository Secret would match only its
 * exact URL, and each Application's repoURL names one chart. The password goes
 * to the cluster only on kubectl's stdin, never to disk, an argument or git. A
 * chart host other than the platform registry (a public or provider-owned
 * registry) gets nothing: the read identity never leaves the registry it
 * belongs to. Returns whether a Secret was applied.
 */
export async function applyChartCredential(
  repository: Repository,
  runner: Runner,
): Promise<boolean> {
  const address = registryAddress(repository);
  const urls = repository.chartDelivery
    ? chartRepositoryUrls(repository.chartDelivery).filter(
        (url) => url === address || url.startsWith(`${address}/`),
      )
    : [];
  if (urls.length === 0 || !koreManagesRegistryAuth(repository)) {
    return false;
  }
  const { username, password } = await loadRegistryCredential(
    repository,
    runner,
    "read",
  );
  await withSecretsRedacted([password], async () => {
    for (const [index, url] of urls.entries()) {
      const name = `kore-platform-charts-${index}`;
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
            metadata: {
              name,
              namespace: argocdNamespace,
              labels: { "argocd.argoproj.io/secret-type": "repo-creds" },
            },
            type: "Opaque",
            stringData: {
              type: "oci",
              url: `oci://${url}`,
              username,
              password,
            },
          }),
        },
      );
    }
  });
  return true;
}
