// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md
// The migration checks of one image. Only the carrier, the image that owns the migrations, reads
// them and runs the N-1 check; every other image attests the empty plan and reads nothing here.
import type { AppSource } from "./app-source.js";
import { contractDeclaration } from "./contract-trailers.js";
import { classifyMigrationFile } from "./migration-file.js";
import { buildPlan, type MigrationPlan } from "./migration-plan.js";
import { MIGRATIONS_PATH } from "./migration-paths.js";
import { migrationReview } from "./migration-rules.js";
import { n1Check, type N1Inputs } from "./n1-check.js";

export interface CarrierInput {
  /** True only for the image that carries the migration plan (--carries-plan). */
  carries: boolean;
  source: AppSource;
  message: string;
  version: string;
  pattern: string | undefined;
  changedPaths: string[];
  newFlags: string[];
  retiredFlags: string[];
  n1: N1Inputs | undefined;
}

export interface CarrierResult {
  failures: string[];
  plan: MigrationPlan;
}

/** The migration failures of this release and the plan it attests; a non-carrier fails nothing. */
export async function migrationCarrier(
  input: CarrierInput,
): Promise<CarrierResult> {
  if (!input.carries) {
    return { failures: [], plan: buildPlan(undefined) };
  }
  const declared = contractDeclaration({
    message: input.message,
    version: input.version,
    pattern: input.pattern,
  });
  const changes = await input.source.changes();
  const added = changes.filter(
    (change) =>
      change.status === "A" && change.path.startsWith(MIGRATIONS_PATH),
  );
  const classified = await Promise.all(
    added.map(async (change) =>
      classifyMigrationFile(
        change.path,
        change.path.endsWith(".sql")
          ? await input.source.headText(change.path)
          : "",
      ),
    ),
  );
  const review = migrationReview({
    declaration: declared.declaration,
    changes,
    changedPaths: input.changedPaths,
    added: classified,
    newFlags: input.newFlags,
    retiredFlags: input.retiredFlags,
  });
  const failures = [...declared.failures, ...review.failures];
  if (review.needsN1) {
    failures.push(...(await n1Check(input.n1)));
  }
  return { failures, plan: buildPlan(review) };
}
