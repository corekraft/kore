// The gate facts handed to the platform-config chart (ADR 0155): the backup target's kind
// and each service's has-data fact, given to the chart on both the Helm path and the Argo
// path. Only kore-platform-config takes them, and only while they are loaded, which is
// only while database-backups is on; any other state hands the chart nothing new.
// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md

import type { Component, Repository } from "../config/index.js";

/** The chart that renders the backup facts ConfigMap, and the value key it reads them from. */
const factsComponent = "kore-platform-config";
const factsKey = "backupFacts";

/** Whether the component takes the facts now: it is the chart that renders them, and they are loaded. */
function takesFacts(repository: Repository, component: Component): boolean {
  return (
    component.name === factsComponent && repository.backupFacts !== undefined
  );
}

/** The facts as one values document for the Argo path, or undefined when the component takes none. */
export function backupFactsValueText(
  repository: Repository,
  component: Component,
): string | undefined {
  if (!takesFacts(repository, component)) {
    return undefined;
  }
  return JSON.stringify({ [factsKey]: repository.backupFacts });
}

/** The facts as one --set-json argument for the Helm path, or none when the component takes none. */
export function backupFactsHelmArgs(
  repository: Repository,
  component: Component,
): string[] {
  if (!takesFacts(repository, component)) {
    return [];
  }
  return [
    "--set-json",
    `${factsKey}=${JSON.stringify(repository.backupFacts)}`,
  ];
}
