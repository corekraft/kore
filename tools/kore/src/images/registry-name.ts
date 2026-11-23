import { lookup } from "node:dns/promises";
import {
  registryByName,
  registryHostname,
  type Environment,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { registryNamespace } from "./registry-auth.js";
import { registryRequest } from "./registry-https.js";
import { loadRegistryCa } from "./registry-tls.js";

// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md

/** The error a TLS client raises when the certificate does not carry the name it dialed. */
const missingNameCode = "ERR_TLS_CERT_ALTNAME_INVALID";

/** A name probe's cause: what to say, and the error code it came from when it had one. */
interface NameFailure {
  problem: string;
  code?: string;
}

/** Where the tailnet forward serves a managed registry on the host (ADR 0143). */
export const forwardAddress = "127.0.0.1:30500";

/**
 * The address host-side callers (digest lookup, cosign, pruning) dial. A k3d
 * registry is always its name, which carries no port because the shared
 * Gateway answers on 443 (ADR 0132); the local port-forward is retired (#1226).
 * A managed environment is its name while registry-by-name is on, and otherwise
 * the tailnet forward (ADR 0143). Nodes pull from the registry's fixed
 * in-cluster address either way (ADR 0031).
 */
export function hostRegistryAddress(environment: Environment): string {
  return environment.provider === "k3d" || registryByName(environment)
    ? registryHostname(environment)
    : forwardAddress;
}

function codeOf(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" ? code : undefined;
}

/** Why the shared Gateway holds no route to the registry, and where to look. */
const routeHint =
  "check that TLSRoute oci-registry in kore-registry is Accepted by the listener tls-registry on kore-system/kore-gateway";

function requestProblem(
  repository: Repository,
  name: string,
  code: string,
): string | undefined {
  const { environment } = repository;
  const platformUp = `run \`kore platform up --env ${environment.name}\``;
  switch (code) {
    case "ECONNREFUSED":
      return `nothing answers ${name} on port 443 (${code}); turn on platform-dns, which publishes the 443 mapping, and recreate a local cluster created without it with \`kore local down --prune\`, then \`kore local up\``;
    case missingNameCode:
      return `the registry's certificate does not carry ${name} (${code}); cert-manager reissues it once registry-by-name is on, and \`kore local up\` restarts the registry proxy to serve it`;
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
      return `${name} is answered with a certificate the registry's CA did not issue (${code}), so the shared Gateway does not pass it through to the registry; ${routeHint}, and ${platformUp}`;
    case "ECONNRESET":
    case "ETIMEDOUT":
      return `${name} is answered with a connection that closes (${code}), so the shared Gateway holds no route for it; ${routeHint}, and ${platformUp}`;
    default:
      return undefined;
  }
}

/**
 * The cause the registry cannot be reached by name, or undefined when it can:
 * the name resolves, and `GET /v2/` over TLS verified against the registry's
 * own CA (ADR 0058) answers with the registry's 200 or the 401 that asks for
 * credentials. Nothing is sent but that unauthenticated request, and an
 * environment that does not reach the registry by name is never probed.
 */
async function nameFailure(
  repository: Repository,
  runner: Runner,
): Promise<NameFailure | undefined> {
  const { environment } = repository;
  if (!registryByName(environment)) {
    return undefined;
  }
  const name = registryHostname(environment);
  const ca = await loadRegistryCa(repository, runner);
  try {
    await lookup(name);
  } catch (error) {
    const code = codeOf(error);
    if (code === undefined) {
      throw error;
    }
    return {
      problem: `${name} does not resolve (${code}); turn on platform-dns, run \`kore dns install --environment ${environment.name}\`, then \`kore local up\` so the platform DNS answers it`,
    };
  }
  try {
    const { status } = await registryRequest(
      "GET",
      `https://${name}/v2/`,
      {},
      ca,
    );
    return status === 200 || status === 401
      ? undefined
      : {
          problem: `${name} answered /v2/ with HTTP ${status}, not the registry's 200 or 401; something other than the registry answers the name`,
        };
  } catch (error) {
    const code = codeOf(error);
    const problem =
      code === undefined ? undefined : requestProblem(repository, name, code);
    if (code === undefined || problem === undefined) {
      throw error;
    }
    return { problem, code };
  }
}

/**
 * Why the registry cannot be reached by name, naming the cause, or undefined
 * when it can. Read-only: the doctor check runs it, so it never restarts anything.
 */
export async function registryNameProblem(
  repository: Repository,
  runner: Runner,
): Promise<string | undefined> {
  return (await nameFailure(repository, runner))?.problem;
}

/**
 * Restarts the registry proxy in the environment's context and waits for its
 * new pod to be ready. The proxy reads its certificate once, at start, so a
 * certificate cert-manager reissued with the name reaches clients only through
 * a restart.
 */
async function restartRegistryProxy(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const kubectl = (...args: string[]): string[] => [
    "--context",
    repository.environment.kubeContext,
    "--namespace",
    registryNamespace,
    ...args,
  ];
  await runner.run(
    "kubectl",
    kubectl("rollout", "restart", "deployment/oci-registry"),
  );
  await runner.run(
    "kubectl",
    kubectl("rollout", "status", "deployment/oci-registry", "--timeout=2m"),
  );
}

/**
 * Makes the registry answer by its name, failing fast with the cause when it
 * cannot. A certificate that lacks the name is the one cause this restarts the
 * registry proxy for: cert-manager reissues the certificate with the name, and
 * the restart makes the proxy serve it. If the name is still missing after that,
 * the failure names the Certificate to check instead of restarting again.
 */
export async function ensureRegistryName(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const failure = await nameFailure(repository, runner);
  if (failure === undefined) {
    return;
  }
  if (failure.code !== missingNameCode) {
    throw new Error(failure.problem);
  }
  await restartRegistryProxy(repository, runner);
  const again = await nameFailure(repository, runner);
  if (again === undefined) {
    return;
  }
  throw new Error(
    again.code === missingNameCode
      ? `${registryHostname(repository.environment)} is still missing from the registry's certificate after the registry proxy restarted (${missingNameCode}); the proxy serves the certificate it read, so check that Certificate oci-registry-tls in ${registryNamespace} is Ready on context ${repository.environment.kubeContext}, then run \`kore local up\` again`
      : again.problem,
  );
}
