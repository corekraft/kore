import type { Repository } from "../config/index.js";
import { minikubeCluster } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { k3dTrustDirectory, writeK3dRegistryCa } from "./k3d-registry-trust.js";
import { minikubeCaTrustArgs } from "./local-image-args.js";
import {
  koreManagesRegistryAuth,
  registryAddress,
  registryNamespace,
} from "./registry-auth.js";

// Docs: docs/decisions/0058-registry-transport-tls.md

/** cert-manager's output: tls.crt, tls.key, and the issuing CA as ca.crt. */
export const registryTlsSecret = "oci-registry-tls";
/** The public CA, for Policy Controller's `registryCaBundle` value. */
export const registryCaConfigMap = "kore-registry-ca";
export const registryCaNamespace = "cosign-system";
const fieldManager = "kore-registry-tls";

const pemCertificate =
  /^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*$/;

function missingCa(repository: Repository, reason: string): Error {
  return new Error(
    `the internal registry's CA ${reason} (Secret ${registryNamespace}/${registryTlsSecret}, key ca.crt); every client verifies it and none skips verification, so run \`kore platform up --env ${repository.environment.name}\` to have cert-manager issue it`,
  );
}

/**
 * Reads the public CA certificate cert-manager published next to the serving
 * certificate. Only ca.crt is read: the CA private key lives in
 * `oci-registry-ca` and kore never touches it. Fails closed when absent.
 */
export async function loadRegistryCa(
  repository: Repository,
  runner: Runner,
): Promise<string> {
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      registryNamespace,
      "get",
      "secret",
      registryTlsSecret,
      "--ignore-not-found",
      "--output=json",
    ],
    { capture: true },
  );
  if (stdout.trim() === "") {
    throw missingCa(repository, "is missing");
  }
  const encoded = (JSON.parse(stdout) as { data?: Record<string, string> })
    .data?.["ca.crt"];
  const pem = Buffer.from(encoded ?? "", "base64").toString("utf8");
  if (pem === "") {
    throw missingCa(repository, "is missing");
  }
  if (!pemCertificate.test(pem)) {
    throw missingCa(repository, "is not a PEM certificate");
  }
  return pem;
}

/** Why trust is not in place, for status; undefined when the CA is readable. */
export async function registryTrustProblem(
  repository: Repository,
  runner: Runner,
): Promise<string | undefined> {
  if (!koreManagesRegistryAuth(repository)) {
    return undefined;
  }
  try {
    await loadRegistryCa(repository, runner);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Hands the public CA to the clients that live in the cluster. Policy
 * Controller reads it from a ConfigMap; on Minikube the node's containerd
 * (and nerdctl) trust it through certs.d, and on k3d the CA is written to the
 * host directory the nodes mount (ADR 0084), so no node is entered. Reapplying identical content is a
 * no-op, so a second run reissues and restarts nothing. An external registry
 * is the provider's to trust, so kore distributes nothing for it.
 */
export async function ensureRegistryTrust(
  repository: Repository,
  runner: Runner,
  home?: string,
): Promise<void> {
  if (!koreManagesRegistryAuth(repository)) {
    return;
  }
  const ca = await loadRegistryCa(repository, runner);
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
        kind: "List",
        items: [
          {
            apiVersion: "v1",
            kind: "Namespace",
            metadata: { name: registryCaNamespace },
          },
          {
            apiVersion: "v1",
            kind: "ConfigMap",
            metadata: {
              name: registryCaConfigMap,
              namespace: registryCaNamespace,
              labels: { "app.kubernetes.io/managed-by": fieldManager },
            },
            data: { "ca.crt": ca },
          },
        ],
      }),
    },
  );
  if (repository.environment.provider === "minikube") {
    await runner.run(
      "minikube",
      minikubeCaTrustArgs(
        minikubeCluster(repository.environment).profile,
        registryAddress(repository),
        ca,
      ),
      { capture: true },
    );
  }
  const k3d = repository.environment.k3d;
  if (repository.environment.provider === "k3d" && k3d !== undefined) {
    await writeK3dRegistryCa(k3dTrustDirectory(k3d.clusterName, home), ca);
  }
}
