import { databaseRoleSplitArgs } from "./database-role-split-args.js";
import { serviceClassArgs } from "./service-class-args.js";
import type { Environment } from "./types.js";

/**
 * The Helm arguments the PostgreSQL API and its RBAC take from the PostgreSQL flags
 * that change the composition: the service-class sizing (ADR 0154) and the role
 * split (ADR 0171). Off, none is passed.
 */
export function postgresqlFlagArgs(
  environment: Environment,
  component: string,
): string[] {
  return [
    ...serviceClassArgs(environment, component),
    ...databaseRoleSplitArgs(environment, component),
  ];
}
