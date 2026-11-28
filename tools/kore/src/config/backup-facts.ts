// The gate facts the external Gateway check reads (ADR 0155): the overlay's target kind
// and, for each service, whether it has data. Pure: the caller reads the overlay and
// the spec files (backup-facts-load.ts) and passes them in. Read-only; the ConfigMap
// that carries these facts is rendered by the platform-config chart.
// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md

import { serviceHasData } from "./service-data.js";
import type { BackupFacts } from "./types.js";

/** A service of the environment: its name and its parsed spec file, undefined when it cannot be read. */
export interface ServiceFactRecord {
  name: string;
  manifest: unknown;
}

/** The facts for a target kind and the environment's service records; a record that cannot be read has data. */
export function backupFacts(
  targetKind: BackupFacts["targetKind"],
  records: readonly ServiceFactRecord[],
): BackupFacts {
  const services: BackupFacts["services"] = {};
  for (const record of records) {
    services[record.name] = { hasData: serviceHasData(record.manifest) };
  }
  return { targetKind, services };
}
