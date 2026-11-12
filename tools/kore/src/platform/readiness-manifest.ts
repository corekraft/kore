import type { Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import {
  admissionGateFieldManager,
  admissionGateStatusName,
  platformGeneration,
} from "./admission-gate.js";
import type { ComponentStatus } from "./status.js";

/**
 * The readiness manifest (infra/catalog/readiness.yaml, ADR 0067) says what
 * must be ready before the application admission gate opens. This module
 * evaluates it against status rows and records the result as evidence.
 */
export const readinessEvidenceName = "kore-platform-readiness";
export const readinessEvidenceNamespace = "kore-system";
const generationLabel = "platform.kore.dev/generation";

export interface PrerequisiteResult {
  name: string;
  status: "ready" | "missing" | "degraded";
  detail: string;
}

export interface RequirementResult {
  name: string;
  step: number;
  capability: string;
  /** `skipped` when every component is gated off by its feature flag. */
  status: "ready" | "failed" | "skipped";
  checks: PrerequisiteResult[];
}

export interface ReadinessFailure extends PrerequisiteResult {
  requirement: string;
}

export interface ReadinessEvidence {
  manifestVersion: number;
  environment: string;
  context: string;
  generation: string;
  /** `open` only when every prerequisite of every requirement was ready. */
  state: "open" | "closed";
  evaluatedAt: string;
  requirements: RequirementResult[];
  failures: ReadinessFailure[];
}

/** `skipped` only when the requirement names components and every one is gated off. */
function requirementStatus(
  named: number,
  checks: PrerequisiteResult[],
): RequirementResult["status"] {
  if (named > 0 && checks.length === 0) {
    return "skipped";
  }
  return checks.every(({ status }) => status === "ready") ? "ready" : "failed";
}

/**
 * Evaluates the manifest against status rows read in this run. A prerequisite
 * with no row is missing, so an incomplete status read can never open the gate.
 */
export function evaluateReadiness(
  repository: Repository,
  rows: readonly ComponentStatus[],
  now: Date = new Date(),
): ReadinessEvidence {
  const byName = new Map(
    rows
      .filter(({ name }) => name !== admissionGateStatusName)
      .map((row) => [row.name, row]),
  );
  const requirements: RequirementResult[] =
    repository.readiness.requirements.map((requirement) => {
      // A component its feature flag gates off is not a prerequisite.
      const names = [
        ...(requirement.components ?? []),
        ...(requirement.platformChecks ?? []),
      ];
      const checks = names.flatMap((name): PrerequisiteResult[] => {
        const row = byName.get(name);
        if (row?.status === "gated-off") {
          return [];
        }
        return [
          row
            ? { name, status: row.status, detail: row.detail }
            : {
                name,
                status: "missing",
                detail: "no status was reported for this prerequisite",
              },
        ];
      });
      return {
        name: requirement.name,
        step: requirement.step,
        capability: requirement.capability,
        status: requirementStatus(names.length, checks),
        checks,
      };
    });
  const failures = requirements.flatMap((requirement) =>
    requirement.checks
      .filter(({ status }) => status !== "ready")
      .map((check) => ({ requirement: requirement.name, ...check })),
  );
  return {
    manifestVersion: repository.readiness.version,
    environment: repository.environment.name,
    context: repository.environment.kubeContext,
    generation: platformGeneration(repository),
    state: failures.length === 0 ? "open" : "closed",
    evaluatedAt: now.toISOString(),
    requirements,
    failures,
  };
}

export function readinessFailureSummary(evidence: ReadinessEvidence): string {
  return evidence.failures
    .map(
      ({ requirement, name, detail }) => `${requirement}: ${name} (${detail})`,
    )
    .join(", ");
}

export function readinessEvidenceObject(evidence: ReadinessEvidence) {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: readinessEvidenceName,
      namespace: readinessEvidenceNamespace,
      labels: {
        "app.kubernetes.io/managed-by": "kore-bootstrap",
        [generationLabel]: evidence.generation,
      },
    },
    data: { "evidence.json": JSON.stringify(evidence) },
  };
}

/**
 * Records the evidence under the gate's field manager, the same single writer.
 * The `kore-readiness-evidence` Role lets only bootstrap automation write it.
 */
export async function recordReadinessEvidence(
  repository: Repository,
  runner: Runner,
  evidence: ReadinessEvidence,
): Promise<void> {
  await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "apply",
      "--server-side",
      `--field-manager=${admissionGateFieldManager}`,
      "--force-conflicts",
      "--filename=-",
    ],
    { capture: true, input: JSON.stringify(readinessEvidenceObject(evidence)) },
  );
}

/** Like {@link recordReadinessEvidence}, but a failure is reported, never thrown. */
export async function tryRecordReadinessEvidence(
  repository: Repository,
  runner: Runner,
  evidence: ReadinessEvidence,
  warn: (message: string) => void,
): Promise<void> {
  try {
    await recordReadinessEvidence(repository, runner, evidence);
  } catch (error) {
    if (!(error instanceof CommandError)) {
      throw error;
    }
    warn(
      `could not record readiness evidence in ${readinessEvidenceNamespace}/${readinessEvidenceName}: ${error.message}`,
    );
  }
}
