import { isLocalProvider, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import {
  foreignCertificateFailure,
  foreignCertificatePrefix,
} from "./foreign-certificate.js";

export { foreignCertificateResources } from "./foreign-certificate.js";

// cert-manager keeps ClusterIssuer CA Secrets in its cluster resource namespace.
const CA_SECRET_NAMESPACE = "cert-manager";
const NOT_FOUND = /NotFound|not found/i;
const TIMED_OUT = /timed out waiting/i;

/**
 * Throws the named failure of a foreign name's Certificate that timed out, its cause and
 * the owner's fix in place of a bare timeout (ADR 0157, issue 1678). Returns for any other
 * error, a platform Certificate's or an unreachable cluster's, so the caller rethrows that
 * error as it was.
 */
export async function namedForeignFailure(
  context: { repository: Repository; runner: Runner; base: string[] },
  resource: string,
  error: unknown,
): Promise<void> {
  if (
    !resource.startsWith(foreignCertificatePrefix) ||
    !(error instanceof Error) ||
    !TIMED_OUT.test(error.message)
  ) {
    return;
  }
  throw new Error(
    await foreignCertificateFailure(
      context.runner,
      context.base,
      resource,
      context.repository.foreignNames ?? [],
    ),
  );
}

/** The actionable fix for a missing issuer, CA Secret, or issued TLS Secret. */
export function trustRemedy(repository: Repository): string {
  return isLocalProvider(repository.environment)
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
