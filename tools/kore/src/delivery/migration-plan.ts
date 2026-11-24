// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md
// The migration-plan predicate. Its key order is part of the signed payload, so it is built here in
// one place and never assembled by callers.
import { MIGRATIONS_PATH } from "./migration-paths.js";
import type {
  ContractSummary,
  MigrationEntry,
  MigrationReview,
  PlanRelease,
} from "./migration-rules.js";

export interface MigrationPlan {
  release: PlanRelease;
  migrationsPath: string | null;
  migrations: MigrationEntry[];
  contract: ContractSummary | null;
  n1: "passed" | "not-applicable";
}

/**
 * The plan one image attests. A non-carrier, or a release with no migration, attests the empty
 * plan. A passing release's N-1 check is "passed" when it needed one: a failure never reaches a
 * pass, so a passing plan cannot carry a failed check.
 */
export function buildPlan(review: MigrationReview | undefined): MigrationPlan {
  if (review === undefined || review.release === "none") {
    return {
      release: "none",
      migrationsPath: null,
      migrations: [],
      contract: null,
      n1: "not-applicable",
    };
  }
  return {
    release: review.release,
    migrationsPath: MIGRATIONS_PATH,
    migrations: review.migrations,
    contract: review.contract,
    n1: review.needsN1 ? "passed" : "not-applicable",
  };
}
