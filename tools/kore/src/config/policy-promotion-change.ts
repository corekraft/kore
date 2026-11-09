import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  auditEvidence,
  constraintsDir,
  isRecord,
  parseJson,
  promotionsDir,
  recordErrors,
  type PromotionRecord,
} from "./policy-promotion.js";
import type { Repository } from "./types.js";

// Docs: docs/decisions/0072-constraint-promotion-procedure.md

export interface PromotionChange {
  constraint: string;
  from: string;
  to: string;
}

const actionLine = /^(\s*enforcementAction:\s*)(\S+)/m;

async function findConstraint(
  repository: Repository,
  name: string,
): Promise<{ path: string; text: string; action: string }> {
  const dir = join(repository.root, constraintsDir);
  const files = (await readdir(dir).catch(() => [])).filter((f) =>
    f.endsWith(".yaml"),
  );
  for (const file of files) {
    const text = await readFile(join(dir, file), "utf8");
    const found = /^metadata:\s*\{\s*name:\s*([^\s,}]+)/m.exec(text)?.[1];
    const action = actionLine.exec(text)?.[2];
    if (found === name && action !== undefined) {
      return { path: join(dir, file), text, action };
    }
  }
  throw new Error(
    `policy: no constraint named ${name} in ${constraintsDir}; list the files there for the exact metadata name`,
  );
}

const recordPath = (repository: Repository, name: string): string =>
  join(repository.root, promotionsDir, `${name}.json`);

async function readRecord(
  repository: Repository,
  name: string,
): Promise<PromotionRecord | undefined> {
  const raw = await readFile(recordPath(repository, name), "utf8").catch(
    () => undefined,
  );
  if (raw === undefined) {
    return undefined;
  }
  const record = parseJson(raw);
  if (!isRecord(record)) {
    throw new Error(
      `policy promotion: ${promotionsDir}/${name}.json is not a valid promotion record; delete it and run kore policy record again`,
    );
  }
  return record;
}

/**
 * Writes the environment's audit evidence for one constraint from the output of
 * `kubectl get <kind> <name> -o json`. Only the timestamp and the violation
 * count are kept; other environments' evidence is preserved.
 */
export async function recordPromotionEvidence(
  repository: Repository,
  name: string,
  constraint: Record<string, unknown>,
): Promise<PromotionRecord> {
  await findConstraint(repository, name);
  const audited = (constraint["metadata"] as { name?: string } | undefined)
    ?.name;
  if (audited !== name) {
    throw new Error(
      `policy: the audit names ${audited ?? "no constraint"}, not ${name}; pass the output of kubectl get for ${name}`,
    );
  }
  const evidence = auditEvidence(constraint);
  if (evidence === undefined) {
    throw new Error(
      `policy: ${name} has not been audited yet; wait for an audit cycle and read it again`,
    );
  }
  const existing = await readRecord(repository, name);
  const record: PromotionRecord = {
    constraint: name,
    from: "dryrun",
    to: existing?.to ?? "deny",
    environments: {
      ...existing?.environments,
      [repository.environment.name]: evidence,
    },
  };
  await mkdir(join(repository.root, promotionsDir), { recursive: true });
  await writeFile(
    recordPath(repository, name),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return record;
}

/**
 * Moves one dryrun constraint to its recorded target action, only when the
 * environment's recorded evidence is recent and shows zero violations. Edits
 * the repository only; `kore platform up` applies it.
 */
export async function promoteConstraint(
  repository: Repository,
  name: string,
  now = new Date(),
): Promise<PromotionChange> {
  const found = await findConstraint(repository, name);
  if (found.action !== "dryrun") {
    throw new Error(
      `policy: ${name} is already ${found.action}; only a dryrun constraint is promoted`,
    );
  }
  const record = await readRecord(repository, name);
  if (record === undefined) {
    throw new Error(
      `policy promotion: ${name} has no promotion record; audit it and run kore policy record ${name} first`,
    );
  }
  const errors = recordErrors(
    name,
    record.to,
    record,
    repository.environment.name,
    now,
  );
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  await writeFile(found.path, found.text.replace(actionLine, `$1${record.to}`));
  return { constraint: name, from: "dryrun", to: record.to };
}

/** Returns one enforcing constraint to dryrun; its evidence stays recorded. */
export async function rollbackConstraint(
  repository: Repository,
  name: string,
): Promise<PromotionChange> {
  const found = await findConstraint(repository, name);
  if (found.action === "dryrun") {
    throw new Error(`policy: ${name} is already dryrun; nothing to roll back`);
  }
  await writeFile(found.path, found.text.replace(actionLine, "$1dryrun"));
  return { constraint: name, from: found.action, to: "dryrun" };
}
