import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

// cert-manager keeps ClusterIssuer CA Secrets in its cluster resource namespace.
const CA_SECRET_NAMESPACE = "cert-manager";
const NOT_FOUND = /NotFound|not found/i;

/** The actionable fix for a missing issuer, CA Secret, or issued TLS Secret. */
export function trustRemedy(repository: Repository): string {
  return repository.environment.provider === "minikube"
    ? `Run: kore trust install --environment ${repository.environment.name}`
    : "Create the ClusterIssuer and its CA Secret for this environment";
}

async function readOrMissing(
  runner: Runner,
  args: string[],
): Promise<string | undefined> {
  try {
    return (await runner.run("kubectl", args, { capture: true })).stdout.trim();
  } catch (error) {
    if (error instanceof Error && NOT_FOUND.test(error.message)) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Read-only preflight for a Certificate: fails with the remedy when its
 * ClusterIssuer or the issuer's CA Secret is absent, instead of letting the
 * Ready wait time out.
 */
export async function assertIssuerReady(
  repository: Repository,
  runner: Runner,
  base: string[],
  resource: string,
): Promise<void> {
  const context = ["--context", repository.environment.kubeContext];
  const ref = (
    await runner.run(
      "kubectl",
      [
        ...base,
        "get",
        resource,
        "--output",
        "jsonpath={.spec.issuerRef.kind}/{.spec.issuerRef.name}",
      ],
      { capture: true },
    )
  ).stdout.trim();
  const [kind, name] = ref.split("/");
  if (kind !== "ClusterIssuer" || !name) {
    return;
  }
  const secretName = await readOrMissing(runner, [
    ...context,
    "get",
    `clusterissuer/${name}`,
    "--output",
    "jsonpath={.spec.ca.secretName}",
  ]);
  if (secretName === undefined) {
    throw new Error(
      `ClusterIssuer ${name} is missing, so ${resource} cannot be issued. ${trustRemedy(repository)}`,
    );
  }
  if (!secretName) {
    return;
  }
  const secret = await readOrMissing(runner, [
    ...context,
    "--namespace",
    CA_SECRET_NAMESPACE,
    "get",
    `secret/${secretName}`,
    "--output",
    "name",
  ]);
  if (secret === undefined) {
    throw new Error(
      `CA Secret ${CA_SECRET_NAMESPACE}/${secretName} for ClusterIssuer ${name} is missing. ${trustRemedy(repository)}`,
    );
  }
}
