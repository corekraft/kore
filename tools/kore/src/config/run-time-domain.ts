// Docs: docs/decisions/0164-the-platform-domain-is-a-run-time-value-and-the-repository-holds-a-placeholder.md
import type { Environment } from "./types.js";

/**
 * The environment variable that replaces a managed environment's placeholder
 * platform domain at run time (ADR 0164). The repository never holds the real name.
 */
export const platformDomainVariable = "KORE_PLATFORM_DOMAIN";

/**
 * The one read of the run-time domain. A managed environment's overlay holds the
 * placeholder, so the variable, when set, is the domain in force; a local
 * environment's domain is its overlay's (ADR 0164).
 */
export function runTimeDomain(
  environment: Environment,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const value = env[platformDomainVariable];
  return environment.provider === "managed" && value ? value : undefined;
}

/** Whether the domain in force comes from the run-time variable or from the overlay. */
export function platformDomainOrigin(
  environment: Environment,
  env: NodeJS.ProcessEnv = process.env,
): "overlay" | "run-time" {
  return runTimeDomain(environment, env) === undefined ? "overlay" : "run-time";
}
