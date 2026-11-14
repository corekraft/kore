import type { Repository } from "../config/index.js";
import type { ComponentStatus } from "../platform/index.js";

/**
 * A ready status row for every prerequisite the readiness manifest names, for
 * fake clusters whose repository may have trimmed the catalog.
 */
export function readyRows(repository: Repository): ComponentStatus[] {
  return repository.readiness.requirements.flatMap((requirement) =>
    [
      ...(requirement.components ?? []),
      ...(requirement.platformChecks ?? []),
    ].map((name): ComponentStatus => ({
      name,
      namespace: "fixture",
      status: "ready",
      detail: "installed and ready",
    })),
  );
}
