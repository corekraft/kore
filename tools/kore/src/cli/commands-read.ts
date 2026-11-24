import { readFile } from "node:fs/promises";
import {
  checkAppRecords,
  checkCrossFileRules,
  checkOrganizationRecords,
  featureEnabled,
  orderedComponents,
  organizationServiceApisFlag,
  platformClaimErrors,
} from "../config/index.js";
import { managedLockErrors } from "../images/index.js";
import {
  doctor,
  doctorFailed,
  validatePortability,
} from "../diagnostics/index.js";
import { readJournal, summarizeOperations } from "../runtime/index.js";
import type { CommandContext } from "./context.js";
import { stringFlag } from "./flags.js";
import { print } from "./output.js";

type Operation = ReturnType<typeof summarizeOperations>[number];

/** Problems of the platform image lock a release published, or throws. */
async function checkPlatformImageLock(
  context: CommandContext,
  path: string,
): Promise<void> {
  let lock: unknown;
  try {
    lock = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(
      `--platform-image-lock ${path} must be the platform-images.lock.json of a release: ${String(error)}`,
    );
  }
  const errors = managedLockErrors(lock, context.repository);
  if (errors.length > 0) {
    throw new Error(
      `platform image lock ${path} does not match environment ${context.repository.environment.name}:\n${errors.join("\n")}`,
    );
  }
}

/**
 * Checks a --platform-claims file against the Organization and Service schemas
 * before validate reports valid. Read-only. Off until the flag is on: the
 * file is then skipped with a warning, never read.
 */
async function checkPlatformClaims(
  context: CommandContext,
  path: string,
): Promise<{ status: "gated-off" } | { status: "valid"; count: number }> {
  const { repository } = context;
  if (!featureEnabled(repository.environment, organizationServiceApisFlag)) {
    console.error(
      `warning: --platform-claims skipped: the ${organizationServiceApisFlag} flag is off in ${repository.environment.name}`,
    );
    return { status: "gated-off" };
  }
  let claims: unknown;
  try {
    claims = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(
      `--platform-claims ${path} must be a JSON array of claims: ${String(error)}`,
    );
  }
  const errors = platformClaimErrors(claims);
  if (errors.length > 0) {
    throw new Error(
      `--platform-claims ${path} does not satisfy the platform API schema:\n${errors.join("\n")}`,
    );
  }
  return { status: "valid", count: (claims as unknown[]).length };
}

export async function validateCommand(
  context: CommandContext,
): Promise<number> {
  const { repository, json } = context;
  const lockPath = stringFlag(context.parsed, "platform-image-lock");
  if (lockPath !== undefined) {
    await checkPlatformImageLock(context, lockPath);
  }
  const claimsPath = stringFlag(context.parsed, "platform-claims");
  const platformClaims =
    claimsPath === undefined
      ? undefined
      : await checkPlatformClaims(context, claimsPath);
  const order = orderedComponents(repository.catalog).map(
    (component) => component.name,
  );
  const portability = await validatePortability(repository, context.runner);
  const catalogNamespaces = repository.catalog.components.map(
    (component) => component.namespace,
  );
  const records = await checkAppRecords({
    root: repository.root,
    environment: repository.environment.name,
    runner: context.runner,
    yqVersion: repository.versions.tools.yq ?? "",
    recordBase: stringFlag(context.parsed, "record-base"),
    hostnames: {
      root: repository.root,
      environment: repository.environment,
      catalogNamespaces,
    },
  });
  const suborgs = await checkOrganizationRecords({
    root: repository.root,
    environment: repository.environment,
    catalogNamespaces,
  });
  const crossFile = await checkCrossFileRules({
    root: repository.root,
    environment: repository.environment,
  });
  const failures = [...suborgs.errors, ...records.errors, ...crossFile.errors];
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
  const warnings = [
    ...(repository.warnings ?? []),
    ...records.warnings,
    ...crossFile.warnings,
  ];
  for (const warning of warnings) {
    console.error(`warning: ${warning}`);
  }
  print(
    {
      environment: repository.environment.name,
      components: order.length,
      order,
      applications: portability.applications,
      status: "valid",
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(platformClaims === undefined ? {} : { platformClaims }),
      ...(suborgs.organizations.length > 0
        ? { organizations: suborgs.organizations }
        : {}),
    },
    json,
  );
  return 0;
}

export async function doctorCommand(context: CommandContext): Promise<number> {
  const checks = await doctor(context.repository, context.runner);
  print(checks, context.json);
  return doctorFailed(checks) ? 1 : 0;
}

function parseLimit(text: string | undefined): number {
  const limit = text === undefined ? 20 : Number(text);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("--limit must be a positive integer");
  }
  return limit;
}

function journalLine(operation: Operation): string {
  return [
    operation.ts,
    operation.outcome === "interrupted" ? "INTERRUPTED" : operation.outcome,
    operation.command,
    operation.error ?? "",
  ].join("\t");
}

function printOperations(operations: Operation[], interrupted: number): void {
  for (const operation of operations) {
    console.log(journalLine(operation));
  }
  if (interrupted > 0) {
    console.log(
      `${interrupted} interrupted operation(s): rerun the command, it is idempotent.`,
    );
  }
}

export async function journalCommand(context: CommandContext): Promise<number> {
  const limit = parseLimit(stringFlag(context.parsed, "limit"));
  const operations = summarizeOperations(
    await readJournal(context.repository.root, context.environmentName),
  );
  const recent = operations.slice(-limit);
  const interrupted = recent.filter(
    (operation) => operation.outcome === "interrupted",
  ).length;
  if (context.json) {
    print(
      { environment: context.environmentName, operations: recent, interrupted },
      true,
    );
  } else {
    printOperations(recent, interrupted);
  }
  return 0;
}
