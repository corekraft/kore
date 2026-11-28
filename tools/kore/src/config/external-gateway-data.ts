// The record-bump refusal of the external Gateway for a service with data (ADR 0155):
// a spec file that sets gateway external while it has data is refused while the
// overlay's backup target kind is interim. Deterministic and read-only; the admission
// constraint on the external route is the ingress spec's, not this file's.
// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md

import { serviceHasData } from "./service-data.js";
import type { BackupTargetDeclaration } from "./types.js";

export type BackupKind = BackupTargetDeclaration["kind"];

export interface ExternalDataInput {
  /** The spec file's repository path, for the message. */
  file: string;
  /** The file name without .json: the service name the record carries. */
  stem: string;
  /** The parsed spec file. */
  manifest: unknown;
  /** The overlay's backup target kind; undefined when the overlay declares no target, so there is no interim kind to refuse on. */
  backupKind: BackupKind | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The refusal of an external service with data while the kind is interim. An
 * internal service, a service with no data, and any service under an off-host
 * target are never refused here.
 */
export function externalDataErrors(input: ExternalDataInput): string[] {
  const { file, stem, manifest, backupKind } = input;
  const spec = isRecord(manifest) ? manifest.spec : undefined;
  if (
    !isRecord(spec) ||
    spec.gateway !== "external" ||
    backupKind !== "interim" ||
    !serviceHasData(manifest)
  ) {
    return [];
  }
  return [
    `${file}: service ${stem} sets gateway: external and has data, but the environment's backup.target kind is interim, so its data has no off-host backup: set spec.gateway to internal until an off-host target exists, or declare an off-host backup.target in the environment overlay and set its kind to off-host (ADR 0155)`,
  ];
}
