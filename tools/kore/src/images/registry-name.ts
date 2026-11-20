import { lookup } from "node:dns/promises";
import {
  registryByName,
  registryHostname,
  type Environment,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { registryRequest } from "./registry-https.js";
import { loadRegistryCa } from "./registry-tls.js";

// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md

/** Where the port-forward serves the registry on the host. */
export const forwardAddress = "127.0.0.1:30500";

/**
 * The address host-side callers (digest lookup, cosign, pruning) dial: the
 * registry's name, which carries no port because the shared Gateway answers on
 * 443, while registry-by-name is on; otherwise the port-forward. Nodes pull
 * from the registry's fixed in-cluster address either way (ADR 0031).
 */
export function hostRegistryAddress(environment: Environment): string {
  return registryByName(environment)
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
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return `the registry's certificate does not carry ${name} (${code}); cert-manager reissues it once registry-by-name is on, but the proxy reads it at start, so run \`kubectl --context ${environment.kubeContext} --namespace kore-registry rollout restart deployment/oci-registry\``;
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
 * Why the registry cannot be reached by name, naming the cause, or undefined
 * when it can: the name resolves, and `GET /v2/` over TLS verified against the
 * registry's own CA (ADR 0058) answers with the registry's 200 or the 401 that
 * asks for credentials. Nothing is sent but that unauthenticated request, and
 * an environment that does not reach the registry by name is never probed.
 */
export async function registryNameProblem(
  repository: Repository,
  runner: Runner,
): Promise<string | undefined> {
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
    return `${name} does not resolve (${code}); turn on platform-dns, run \`kore dns install --environment ${environment.name}\`, then \`kore local up\` so the platform DNS answers it`;
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
      : `${name} answered /v2/ with HTTP ${status}, not the registry's 200 or 401; something other than the registry answers the name`;
  } catch (error) {
    const code = codeOf(error);
    const problem =
      code === undefined ? undefined : requestProblem(repository, name, code);
    if (problem === undefined) {
      throw error;
    }
    return problem;
  }
}

/** Fails fast, naming the cause, when the registry cannot be reached by name. */
export async function ensureRegistryName(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const problem = await registryNameProblem(repository, runner);
  if (problem !== undefined) {
    throw new Error(problem);
  }
}
