import { databaseRoleSplitFlag, featureEnabled } from "./features.js";
import type { Environment } from "./types.js";

// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md

/**
 * With database-role-split on, the value the PostgreSQL API and its RBAC take to
 * give the composition a DDL and a DML role beside the app role (ADR 0171). Both
 * charts take it, because the composition needs the RBAC to create the role
 * passwords' generators and ExternalSecrets. Off, none is passed, so both render
 * what they rendered before.
 */
export function databaseRoleSplitArgs(
  environment: Environment,
  component: string,
): string[] {
  if (
    (component !== "kore-postgresql-api" &&
      component !== "kore-postgresql-rbac") ||
    !featureEnabled(environment, databaseRoleSplitFlag)
  ) {
    return [];
  }
  return ["--set", "databaseRoleSplit=true"];
}
