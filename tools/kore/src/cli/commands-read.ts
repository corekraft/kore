import { readFile } from "node:fs/promises";
import { orderedComponents, policyWarnings } from "../config/index.js";
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

export async function validateCommand(
  context: CommandContext,
): Promise<number> {
  const { repository, json } = context;
  const lockPath = stringFlag(context.parsed, "platform-image-lock");
  if (lockPath !== undefined) {
    await checkPlatformImageLock(context, lockPath);
  }
  const order = orderedComponents(repository.catalog).map(
    (component) => component.name,
  );
  const portability = await validatePortability(repository, context.runner);
  print(
    {
      environment: repository.environment.name,
      components: order.length,
      order,
      applications: portability.applications,
      warnings: await policyWarnings(repository),
      status: "valid",
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
