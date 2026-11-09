import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Repository } from "./types.js";

// Docs: docs/decisions/0059-identity-policy-evidence.md
const constraintsDir = "infra/policies/gatekeeper/constraints";
const promotionsDir = "infra/policies/gatekeeper/promotions";
const actions = ["dryrun", "warn", "deny"] as const;
const maxEvidenceAgeDays = 14;

export interface AuditEvidence {
  observedAt: string;
  totalViolations: number;
}

/** What `infra/policies/gatekeeper/promotions/<constraint>.json` holds. */
export interface PromotionRecord {
  constraint: string;
  from: "dryrun";
  to: "warn" | "deny";
  environments: Record<string, AuditEvidence>;
}

/**
 * The evidence a constraint's own audit status gives, from
 * `kubectl get <kind> <name> -o json`. Only the timestamp and the count are
 * kept, so violation messages never reach a committed record.
 */
export function auditEvidence(
  constraint: Record<string, unknown>,
): AuditEvidence | undefined {
  const { auditTimestamp, totalViolations } = (constraint["status"] ??
    {}) as Record<string, unknown>;
  return typeof auditTimestamp === "string" &&
    typeof totalViolations === "number"
    ? { observedAt: auditTimestamp, totalViolations }
    : undefined;
}

const sampleSize = 5;

export interface AuditReport {
  name: string;
  action: string;
  evidence: AuditEvidence | undefined;
  /** First violating resources as kind/[namespace/]name; messages are dropped. */
  sample: string[];
  /** Set when the constraint enforces (deny/warn) and must be clean. */
  failure?: string;
}

/**
 * Evaluates one constraint's audit status. Enforcing constraints (deny, warn)
 * must have zero violations. A dryrun constraint is recorded as evidence with
 * its first violating resources and never fails, since the plan promotes
 * constraints one at a time.
 */
export function evaluateAudit(
  constraint: Record<string, unknown>,
): AuditReport {
  const metadata = (constraint["metadata"] ?? {}) as { name?: string };
  const spec = (constraint["spec"] ?? {}) as { enforcementAction?: string };
  const name = metadata.name ?? "";
  const action = spec.enforcementAction ?? "deny";
  const evidence = auditEvidence(constraint);
  const listed = ((constraint["status"] as { violations?: unknown } | undefined)
    ?.violations ?? []) as {
    kind?: string;
    namespace?: string;
    name?: string;
  }[];
  const sample = listed
    .slice(0, sampleSize)
    .map((v) =>
      [v.kind, v.namespace, v.name]
        .filter((p) => p !== undefined && p !== "")
        .join("/"),
    );
  let failure: string | undefined;
  if (evidence === undefined) {
    failure = `${name} has not been audited yet; wait a cycle`;
  } else if (action !== "dryrun" && evidence.totalViolations > 0) {
    failure = `${name} enforces ${action} but reports ${evidence.totalViolations} violations (${sample.join(", ")}); the platform, including its controllers, must comply`;
  }
  return { name, action, evidence, sample, ...(failure ? { failure } : {}) };
}

const isEvidence = (value: unknown): value is AuditEvidence => {
  const e = value as Partial<AuditEvidence> | null;
  return (
    typeof e?.observedAt === "string" &&
    !Number.isNaN(Date.parse(e.observedAt)) &&
    Number.isInteger(e.totalViolations) &&
    (e.totalViolations ?? -1) >= 0
  );
};

const isRecord = (value: unknown): value is PromotionRecord => {
  const r = value as Partial<PromotionRecord> | null;
  return (
    typeof r?.constraint === "string" &&
    r.from === "dryrun" &&
    (r.to === "warn" || r.to === "deny") &&
    typeof r.environments === "object" &&
    r.environments !== null &&
    Object.values(r.environments).every(isEvidence)
  );
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

async function jsonFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

function recordErrors(
  constraint: string,
  action: string,
  record: unknown,
  environment: string,
  now: Date,
): string[] {
  if (!isRecord(record)) {
    return [
      `policy promotion: ${promotionsDir}/${constraint}.json is not a valid promotion record (constraint, from: dryrun, to: warn|deny, environments with observedAt and totalViolations)`,
    ];
  }
  const evidence = record.environments[environment];
  const age = evidence
    ? (now.getTime() - Date.parse(evidence.observedAt)) / 86_400_000
    : 0;
  return [
    ...(record.constraint === constraint
      ? []
      : [
          `policy promotion: ${constraint}.json names constraint ${record.constraint}`,
        ]),
    ...(record.to === action
      ? []
      : [
          `policy promotion: ${constraint} promotes to ${record.to} but the constraint enforces ${action}`,
        ]),
    ...(evidence === undefined
      ? [
          `policy promotion: ${constraint} has no audit evidence for environment ${environment}; audit it there and record the result`,
        ]
      : []),
    ...(evidence && evidence.totalViolations > 0
      ? [
          `policy promotion: ${constraint} had ${evidence.totalViolations} audit violations in environment ${environment}; fix the platform before enforcing`,
        ]
      : []),
    ...(evidence && age > maxEvidenceAgeDays
      ? [
          `policy promotion: ${constraint} evidence for environment ${environment} is older than ${maxEvidenceAgeDays} days; audit again`,
        ]
      : []),
  ];
}

/**
 * Every constraint starts in dryrun. One may enforce only through its own
 * promotion record with recent zero-violation audit evidence for the validated
 * environment, so promotion is per constraint and never a bulk flip.
 */
export async function policyPromotionErrors(
  repository: Repository,
  now = new Date(),
): Promise<string[]> {
  const dir = join(repository.root, constraintsDir);
  const files = (await readdir(dir).catch(() => [])).filter((f) =>
    f.endsWith(".yaml"),
  );
  const errors: string[] = [];
  for (const file of files) {
    const text = await readFile(join(dir, file), "utf8");
    const name = /^metadata:\s*\{\s*name:\s*([^\s,}]+)/m.exec(text)?.[1];
    const action = /^\s*enforcementAction:\s*(\S+)/m.exec(text)?.[1];
    if (name === undefined || action === undefined) {
      errors.push(
        `policy promotion: ${constraintsDir}/${file} needs metadata name and spec.enforcementAction`,
      );
    } else if (!(actions as readonly string[]).includes(action)) {
      errors.push(
        `policy promotion: ${name} enforcementAction ${action} must be dryrun, warn, or deny`,
      );
    } else if (action !== "dryrun") {
      const present = await jsonFiles(join(repository.root, promotionsDir));
      if (!present.includes(`${name}.json`)) {
        errors.push(
          `policy promotion: ${name} enforces ${action} without ${promotionsDir}/${name}.json; record zero-violation audit evidence for each environment first`,
        );
        continue;
      }
      const raw = parseJson(
        await readFile(
          join(repository.root, promotionsDir, `${name}.json`),
          "utf8",
        ),
      );
      errors.push(
        ...recordErrors(name, action, raw, repository.environment.name, now),
      );
    }
  }
  return errors;
}
