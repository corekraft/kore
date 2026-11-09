import type { Repository } from "./types.js";

/** Problems with the namespaces exempt from enrollment (ADR 0056). */
export function enrollmentExemptionErrors(repository: Repository): string[] {
  const namespaces = new Set(
    (repository.catalog.components ?? []).map((c) => c.namespace),
  );
  return Object.entries(
    repository.environment.enrollmentExemptions ?? {},
  ).flatMap(([namespace, reason]) => [
    ...(namespaces.has(namespace)
      ? []
      : [
          `environment.enrollmentExemptions: ${namespace} is not a platform namespace of the catalog`,
        ]),
    ...(typeof reason === "string" && reason.trim() !== ""
      ? []
      : [`environment.enrollmentExemptions: ${namespace} needs a reason`]),
  ]);
}
