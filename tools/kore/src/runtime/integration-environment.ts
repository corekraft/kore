// Docs: AGENTS.md "Mutations are serialized per environment."

/**
 * The environment integration specs test: `KORE_INTEGRATION_ENVIRONMENT`, or
 * `local`. The lock key and every spec's `loadRepository` read it here, so the
 * variable picks the cluster tested and not only the lock taken.
 */
export function integrationEnvironment(): string {
  return process.env.KORE_INTEGRATION_ENVIRONMENT ?? "local";
}
